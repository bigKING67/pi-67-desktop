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
      if (type === "image.project.read") return Promise.resolve({ projectId: "p", revision: host.revision, latestRevision: host.revision, sha256: "s", document: { title: "海报", canvas: { width: 100, height: 100, background: "#fff" }, objects: host.objectIds.map((id) => ({ id, kind: "rect", locked: false, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1, color: "#000000", radius: 0 })) } });
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
      return Promise.reject(new Error(`unexpected ${type}`));
    }
  }
}));
vi.mock("../notifications/notification-store.js", () => ({ publishNotification: (notice: { level: string; title: string; message: string }) => notices.push(notice) }));

import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  acceptCandidate,
  checkImageEdit,
  discardCandidate,
  inspectCandidate,
  editImageProject,
  editImageProjectWithNotice,
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

  it("returns the canvas to the revision once the previewed candidate is accepted or discarded", async () => {
    inspectCandidate("warm");
    expect(await acceptCandidate("warm")).toBe(true);
    expect(useImageProject.getState()).toMatchObject({ inspecting: undefined, revision: 2 });
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
