import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolRequestError } from "@pi67/protocol";

const host = vi.hoisted(() => ({
  revision: 1, calls: [] as { type: string; payload: Record<string, unknown> }[], conflictNext: false,
  refuseNext: undefined as { message: string; imageReason: string } | undefined, objectIds: ["t", "u"]
}));
const notices = vi.hoisted(() => [] as { level: string; title: string; message: string }[]);

vi.mock("../connection/AgentConnectionController.js", () => ({
  agentConnectionController: {
    subscribe: () => () => undefined,
    request: (type: string, payload: Record<string, unknown>) => {
      host.calls.push({ type, payload });
      if (type === "image.project.read") return Promise.resolve({ projectId: "p", revision: host.revision, latestRevision: host.revision, sha256: "s", document: { title: "海报", canvas: { width: 100, height: 100, background: "#fff" }, assets: [], objects: host.objectIds.map((id) => ({ id, kind: "rect", locked: false, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1, color: "#000000", radius: 0 })) } });
      if (type === "image.project.render") return Promise.resolve({ projectId: "p", revision: host.revision, pngSha256: "a".repeat(64), width: 100, height: 100 });
      if (type === "image.candidate.list") return Promise.resolve({ projectId: "p", candidates: [] });
      if (type === "image.project.edit") {
        if (host.conflictNext) {
          host.conflictNext = false; host.revision += 1;
          return Promise.reject(new ProtocolRequestError({ code: "RESOURCE_CHANGED_EXTERNALLY", message: "Revision conflict", recoverable: true, details: { imageReason: "revision_conflict" } }));
        }
        if (host.refuseNext) {
          const { message, imageReason } = host.refuseNext; host.refuseNext = undefined;
          return Promise.reject(new ProtocolRequestError({ code: "INVALID_PAYLOAD", message, recoverable: true, details: { imageReason } }));
        }
        if (payload.dryRun === true) return Promise.resolve({ projectId: "p", revision: host.revision + 1, sha256: "s", dryRun: true });
        host.revision += 1;
        return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s", dryRun: false });
      }
      if (type === "image.candidate.accept") { host.revision += 1; return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s" }); }
      if (type === "image.candidate.discard") return Promise.resolve({ projectId: "p", candidateId: payload.candidateId, status: "discarded" });
      if (type === "image.project.history") return Promise.resolve({ projectId: "p", revisions: [] });
      if (type === "image.project.addFont") {
        if (payload.attachmentId === "bad") return Promise.reject(new ProtocolRequestError({ code: "INVALID_PAYLOAD", message: "Unsupported font file: not TrueType or OpenType", recoverable: true }));
        host.revision += 1;
        return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s", dryRun: false, fontId: "font-1", family: "Brand Sans" });
      }
      if (type === "image.project.derive") return Promise.resolve({ projectId: "p", revision: host.revision, results: (payload.presets as string[]).map((preset) => preset === "16x9"
        ? { preset, status: "refused", reason: "文字「春日」在 178×100 里放不下" }
        : { preset, status: "derived", projectId: `p-${preset}`, title: `海报 · ${preset}`, canvas: { width: 100, height: 100, background: "#fff" }, shrunkText: 0 }) });
      return Promise.reject(new Error(`unexpected ${type}`));
    }
  }
}));
vi.mock("../notifications/notification-store.js", () => ({ publishNotification: (notice: { level: string; title: string; message: string }) => notices.push(notice) }));

import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useImageWorkbench } from "./image-workbench-store.js";
import {
  acceptCandidate,
  addImageFont,
  addImageObject,
  checkImageEdit,
  deriveImageSizes,
  derivedSizes,
  discardCandidate,
  inspectCandidate,
  editImageProject,
  editImageProjectWithNotice,
  exportImageSizes,
  loadImageProject,
  primaryImageObject,
  redoImageEdit,
  selectImageObject,
  undoImageEdit,
  useImageProject
} from "./image-project-controller.js";

const edits = () => host.calls.filter((call) => call.type === "image.project.edit").map((call) => call.payload);

beforeEach(async () => {
  host.revision = 1; host.calls = []; host.conflictNext = false; host.refuseNext = undefined; host.objectIds = ["t", "u"]; notices.length = 0;
  rendererWorkbenchStore.setState({ imageLibraryWorkspaceId: "lib" });
  useImageProject.setState({ projectId: undefined });
  await loadImageProject("p");
});

describe("image project editing", () => {
  it("submits against the revision on screen and undoes to the content shown before, not revision - 1", async () => {
    expect(await editImageProject("改标题", [{ type: "update_object", id: "t", patch: { text: "春" } }])).toEqual({ outcome: "applied" });
    await editImageProject("移动", [{ type: "update_object", id: "t", patch: { x: 4 } }]);
    expect(useImageProject.getState()).toMatchObject({ revision: 3, back: [1, 2], forward: [] });
    await undoImageEdit();
    await undoImageEdit();
    await redoImageEdit();
    expect(edits().map((payload) => [payload.baseRevision, (payload.operations as { type: string; revision?: number }[])[0]])).toEqual([
      [1, { type: "update_object", id: "t", patch: { text: "春" } }], [2, { type: "update_object", id: "t", patch: { x: 4 } }],
      [3, { type: "revert_to", revision: 2 }], [4, { type: "revert_to", revision: 1 }], [5, { type: "revert_to", revision: 4 }]
    ]);
    expect(useImageProject.getState()).toMatchObject({ revision: 6, back: [5], forward: [3] });
    await editImageProject("新改动", [{ type: "update_object", id: "t", patch: { y: 1 } }]);
    expect(useImageProject.getState().forward).toEqual([]);
  });

  it("refreshes on a conflict and reports it so the caller keeps the draft", async () => {
    host.conflictNext = true;
    expect(await editImageProject("改标题", [{ type: "update_object", id: "t", patch: { text: "春" } }])).toEqual({ outcome: "conflict" });
    expect(useImageProject.getState()).toMatchObject({ revision: 2, back: [] });
    expect(await editImageProject("改标题", [{ type: "update_object", id: "t", patch: { text: "春" } }])).toEqual({ outcome: "applied" });
    expect(edits().at(-1)?.baseRevision).toBe(2);
  });

  it("turns engine refusals into product copy and surfaces direct-edit refusals as a notice", async () => {
    host.refuseNext = { message: "Text overflow: t", imageReason: "text_overflow" };
    expect(await editImageProject("调整大小", [{ type: "update_object", id: "t", patch: { width: 4 } }]))
      .toEqual({ outcome: "refused", message: "文字放不下：把文本框调大，或减小字号、行高。" });
    host.refuseNext = { message: "Object outside canvas: t", imageReason: "invalid" };
    await editImageProjectWithNotice("移动", [{ type: "update_object", id: "t", patch: { x: 4000 } }]);
    host.refuseNext = { message: "Invalid object.width", imageReason: "invalid" };
    expect(await editImageProject("修改画布宽", [{ type: "set_canvas", canvas: { width: 500, height: 100, background: "#ffffff" } }]))
      .toEqual({ outcome: "refused", message: "对象需要完整留在画布内：先移动或缩小超出的对象。" });
    host.refuseNext = { message: "Invalid radius", imageReason: "invalid" };
    expect(await editImageProject("修改圆角", [{ type: "update_object", id: "t", patch: { radius: 99 } }])).toEqual({ outcome: "refused", message: "数值超出允许范围。" });
    expect(notices).toEqual([{ level: "warning", title: "没能移动", message: "对象需要完整留在画布内：先移动或缩小超出的对象。" }]);
    expect(useImageProject.getState().revision).toBe(1);
  });
});

describe("image object selection", () => {
  it("keeps marks across a reload but drops references whose layer is gone or not an image", async () => {
    const marks = [{ id: "m1", x: 0, y: 0, width: 10, height: 10, instruction: "换色" }];
    useImageProject.setState({ marks, references: [{ objectId: "gone", role: "keep-style" }, { objectId: "t", role: "keep-subject" }] });
    await loadImageProject("p");
    expect(useImageProject.getState().references).toEqual([]);
    expect(useImageProject.getState().marks).toBe(marks);
  });

  it("extends with Shift, keeps the last as primary, and drops objects that left the document", async () => {
    selectImageObject("t");
    selectImageObject("u", { extend: true });
    expect(useImageProject.getState().selectedObjectIds).toEqual(["t", "u"]);
    expect(primaryImageObject(useImageProject.getState())?.id).toBe("u");
    selectImageObject("t", { extend: true });
    expect(useImageProject.getState().selectedObjectIds).toEqual(["u"]);
    selectImageObject("t", { extend: true });
    const before = useImageProject.getState().selectedObjectIds;
    await loadImageProject("p");
    expect(useImageProject.getState().selectedObjectIds).toBe(before);
    host.objectIds = ["t"];
    await loadImageProject("p");
    expect(useImageProject.getState().selectedObjectIds).toEqual(["t"]);
    selectImageObject(undefined);
    expect(useImageProject.getState().selectedObjectIds).toEqual([]);
  });

  it("compares a stale candidate against its own base revision, rendering each once even when pressed twice", async () => {
    useImageProject.setState({ revision: 3, candidates: [{ candidateId: "old", status: "stale", baseRevision: 1 }], candidateCanvases: {}, revisionCanvases: {} });
    host.calls = [];
    inspectCandidate("old");
    inspectCandidate("old", { compare: true });
    inspectCandidate("old", { compare: true });
    const renders = host.calls.filter((call) => call.type === "image.project.render").map((call) => call.payload);
    expect(renders).toEqual([{ projectId: "p", candidateId: "old", previewMax: 1600 }, { projectId: "p", revision: 1, previewMax: 1600 }]);
    await vi.waitFor(() => expect(useImageProject.getState().revisionCanvases[1]).toBeDefined());
  });

  it("renders an inspected candidate once at the canvas size and compares only while inspecting", async () => {
    host.calls = [];
    inspectCandidate("warm", { compare: true });
    await Promise.resolve();
    expect(useImageProject.getState()).toMatchObject({ inspecting: "warm", comparing: true });
    const renders = () => host.calls.filter((call) => call.type === "image.project.render" && call.payload.candidateId === "warm");
    expect(renders().map((call) => call.payload.previewMax)).toEqual([1600]);
    await vi.waitFor(() => expect(useImageProject.getState().candidateCanvases.warm).toBeDefined());
    inspectCandidate("warm");
    expect(renders()).toHaveLength(1);
    inspectCandidate(undefined, { compare: true });
    expect(useImageProject.getState()).toMatchObject({ inspecting: undefined, comparing: false });
  });

  it("derives presets from the revision on screen, replaces a re-derived preset, and exports this revision with every derived size", async () => {
    host.calls = [];
    const results = await deriveImageSizes(["1x1", "16x9"]);
    expect(host.calls.find((call) => call.type === "image.project.derive")?.payload).toEqual({ projectId: "p", revision: 1, presets: ["1x1", "16x9"] });
    expect(results?.map((item) => item.status)).toEqual(["derived", "refused"]);
    await deriveImageSizes(["1x1"]);
    expect(useImageProject.getState().derived.map((item) => item.preset)).toEqual(["16x9", "1x1"]);

    // The library lists every derived size, from any session: per preset the newest from this revision goes in the set.
    const canvas = { width: 100, height: 100, background: "#fff" };
    const size = (projectId: string, preset: "1x1" | "4x5", revision: number, updatedAt: number) =>
      ({ projectId, title: projectId, revision: 1, canvas, updatedAt, readyCandidates: 0, derivedFrom: { projectId: "p", revision, preset } });
    useImageWorkbench.setState({ projects: [size("p-1x1", "1x1", 1, 1), size("p-1x1-2", "1x1", 1, 2), size("p-4x5", "4x5", 0, 3),
      { projectId: "other", title: "other", revision: 1, canvas, updatedAt: 4, readyCandidates: 0 }] });
    expect(derivedSizes(useImageWorkbench.getState().projects, "p", 1)).toMatchObject({
      current: [{ projectId: "p-1x1-2" }], older: [{ projectId: "p-1x1" }, { projectId: "p-4x5" }] });
    const saveImageSet = vi.fn(() => Promise.resolve({ folderName: "海报 导出" }));
    vi.stubGlobal("window", { pi67: { system: { saveImageSet } } });
    rendererWorkbenchStore.setState({ imageLibraryWorkspaceId: "lib" } as never);
    host.calls = [];
    await exportImageSizes();
    // The source is pinned to the revision on screen; derived sizes have one revision each.
    expect(host.calls.filter((call) => call.type === "image.project.render").map((call) => [call.payload.projectId, call.payload.revision])).toEqual([["p", 1], ["p-1x1-2", undefined]]);
    expect(saveImageSet).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "lib", title: "海报", items: [
      expect.objectContaining({ projectId: "p", fileName: "海报 100×100" }), expect.objectContaining({ projectId: "p-1x1-2" })] }));
    expect(notices.at(-1)).toMatchObject({ level: "success", title: "已导出 2 张图片" });
    expect(useImageProject.getState().busy).toBe(false);
    // A newer revision leaves the earlier sizes out of the next set.
    useImageProject.setState({ revision: 2 });
    host.calls = [];
    await exportImageSizes();
    expect(host.calls.filter((call) => call.type === "image.project.render").map((call) => call.payload.projectId)).toEqual(["p"]);
    vi.unstubAllGlobals();
  });

  it("adds text, rectangles and ellipses centred on the canvas with ids that never collide, and selects them", async () => {
    host.calls = [];
    expect(await addImageObject("ellipse")).toEqual({ outcome: "applied" });
    expect(edits().at(-1)).toMatchObject({ summary: "添加椭圆", operations: [{ type: "add_object", object: { id: "ellipse", kind: "ellipse", x: 35, y: 35, width: 30, height: 30, color: "#d9c2a3" } }] });
    expect(useImageProject.getState().selectedObjectIds).toEqual(["ellipse"]);
    host.objectIds = ["t", "u", "text"];
    await loadImageProject("p");
    await addImageObject("text");
    expect(edits().at(-1)?.operations).toMatchObject([{ type: "add_object", object: { id: "text-2", kind: "text", text: "新文字", align: "center" } }]);
  });

  it("adds a staged font, sets it on the text as a second revision, and explains refusals in product words", async () => {
    const released: string[][] = [];
    let next = "good";
    vi.stubGlobal("window", { pi67: { system: {
      stagePromptAttachments: () => Promise.resolve([{ id: next, kind: "file" }]),
      releasePromptAttachments: (ids: string[]) => { released.push(ids); return Promise.resolve(); }
    } } });
    host.calls = [];
    expect(await addImageFont(new File([new Uint8Array(4)], "Brand.ttf"), "t")).toBe(true);
    expect(host.calls.find((call) => call.type === "image.project.addFont")?.payload).toEqual({ projectId: "p", baseRevision: 1, attachmentId: "good" });
    expect(edits().at(-1)).toMatchObject({ baseRevision: 2, summary: "使用字体 Brand Sans", operations: [{ type: "update_object", id: "t", patch: { font_id: "font-1" } }] });
    next = "bad";
    expect(await addImageFont(new File([new Uint8Array(4)], "Brand.ttf"))).toBe(false);
    expect(notices.at(-1)).toMatchObject({ title: "没能添加字体", message: expect.stringContaining("不是可用的 TTF 或 OTF") });
    // Refused by name before anything is staged.
    expect(await addImageFont(new File([new Uint8Array(4)], "Brand.woff2"))).toBe(false);
    expect(notices.at(-1)?.message).toBe("请选择 TTF 或 OTF 字体文件。");
    expect(released).toEqual([["good"], ["bad"]]);
    // Bound, but using it on the text fails: say so, and refresh to the bound revision.
    next = "good";
    host.refuseNext = { message: "Text overflow: t", imageReason: "text_overflow" };
    expect(await addImageFont(new File([new Uint8Array(4)], "Brand.ttf"), "t")).toBe(false);
    expect(notices.at(-1)).toMatchObject({ level: "warning", title: "已添加字体 Brand Sans", message: expect.stringContaining("但没能用在这段文字上") });
    expect(useImageProject.getState().revision).toBe(host.revision);
    expect(useImageProject.getState().busy).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns the canvas to the revision once the previewed candidate is accepted or discarded", async () => {
    inspectCandidate("warm", { compare: true });
    expect(await acceptCandidate("warm")).toBe(true);
    expect(useImageProject.getState()).toMatchObject({ inspecting: undefined, comparing: false, revision: 2 });
    inspectCandidate("cool");
    expect(await discardCandidate("other")).toBe(true);
    expect(useImageProject.getState().inspecting).toBe("cool");
    expect(await discardCandidate("cool")).toBe(true);
    expect(useImageProject.getState().inspecting).toBeUndefined();
  });

  it("checks a draft with a dry run that never publishes or touches undo history", async () => {
    expect(await checkImageEdit([{ type: "update_object", id: "t", patch: { text: "春日" } }])).toEqual({ outcome: "applied" });
    expect(edits().at(-1)).toMatchObject({ dryRun: true, baseRevision: 1 });
    expect(useImageProject.getState()).toMatchObject({ revision: 1, back: [] });
    host.refuseNext = { message: "Text overflow: t", imageReason: "text_overflow" };
    expect(await checkImageEdit([{ type: "update_object", id: "t", patch: { text: "很长很长的文字" } }]))
      .toEqual({ outcome: "refused", message: "文字放不下：把文本框调大，或减小字号、行高。" });
  });
});
