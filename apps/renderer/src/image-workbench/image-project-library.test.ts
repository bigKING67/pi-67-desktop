import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../connection/AgentConnectionController.js", async () => (await import("./image-project-test-support.js")).mockConnection);
vi.mock("../notifications/notification-store.js", async () => (await import("./image-project-test-support.js")).mockNotifications);

import { host, notices } from "./image-project-test-support.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useImageWorkbench } from "./image-workbench-store.js";
import { loadImageProject, useImageProject } from "./image-project-controller.js";
import { exportImageProject } from "./image-project-export.js";

// P5 work on the library from the image page: batches, templates, the team hand-off and the brand kit.

const edits = () => host.calls.filter((call) => call.type === "image.project.edit").map((call) => call.payload);

beforeEach(async () => {
  host.revision = 1; host.calls = []; host.conflictNext = false; host.refuseNext = undefined; host.objectIds = ["t", "u"]; host.unreadNext = false; notices.length = 0;
  rendererWorkbenchStore.setState({ imageLibraryWorkspaceId: "lib" });
  useImageProject.setState({ projectId: undefined });
  await loadImageProject("p");
});

describe("image library work: batches, templates, hand-off, brand", () => {
  it("matches a CSV to text layers, runs it as a batch, and removes the batch only when told to", async () => {
    const { chooseBatchTable, createImageBatch, removeImageBatch, useImageBatch, batchesOf, showBatchesOf } = await import("./image-project-batch.js");
    showBatchesOf("p");
    const document = useImageProject.getState().document!;
    useImageProject.setState({ document: { ...document, objects: [{ ...document.objects[0]!, kind: "text", text: "¥199", font_size: 20, color: "#000000", align: "left", line_height: 1.2 } as never] } });
    await chooseBatchTable(new File(["t,备注\n¥299,x\n¥1999999,y\n"], "prices.csv"));
    expect(useImageBatch.getState().draft).toMatchObject({ fileName: "prices.csv", matched: [{ column: "t", layer: "t" }], unmatched: ["备注"], rows: [{ row: 1, texts: [{ layer: "t", text: "¥299" }] }, { row: 2, texts: [{ layer: "t", text: "¥1999999" }] }] });
    await createImageBatch();
    expect(host.calls.find((call) => call.type === "image.batch.create")?.payload).toEqual({ projectId: "p", revision: 1, rows: [{ row: 1, texts: [{ layer: "t", text: "¥299" }] }, { row: 2, texts: [{ layer: "t", text: "¥1999999" }] }] });
    expect(useImageBatch.getState()).toMatchObject({ draft: undefined, last: { batchId: "b1", revision: 1 } });
    expect(notices.at(-1)).toMatchObject({ level: "warning", title: "已生成 1 个变体" });
    const member = { projectId: "p-b1-1", title: "海报 · ¥299", revision: 2, canvas: { width: 100, height: 100, background: "#fff" }, updatedAt: 1, readyCandidates: 0, batch: { batchId: "b1", row: 1, projectId: "p", revision: 1 } };
    useImageWorkbench.setState({ projects: [member] });
    expect(batchesOf([member], "p")).toEqual([{ batchId: "b1", projectId: "p", revision: 1, members: [member] }]);
    let removal = removeImageBatch("b1");
    await vi.waitFor(() => expect(useImageBatch.getState().removing).toMatchObject({ total: 1, edited: 1 }));
    useImageBatch.getState().removing!.decide(false);
    await removal;
    expect(host.calls.some((call) => call.type === "image.batch.remove")).toBe(false);
    removal = removeImageBatch("b1");
    await vi.waitFor(() => expect(useImageBatch.getState().removing).toBeDefined());
    useImageBatch.getState().removing!.decide(true);
    await removal;
    expect(host.calls.find((call) => call.type === "image.batch.remove")?.payload).toEqual({ batchId: "b1" });
    expect(useImageBatch.getState().last).toBeUndefined();
    await chooseBatchTable(new File(["x"], "prices.xlsx"));
    expect(useImageBatch.getState().draft?.problem).toMatch(/CSV/u);
  });

  it("saves a template, toggles a slot, and makes a project from it with a staged picture and only changed words", async () => {
    const { saveAsTemplate, toggleTemplateSlot, createFromTemplate } = await import("./image-project-template.js");
    const released: string[][] = [];
    vi.stubGlobal("window", { pi67: { system: { stagePromptAttachments: (files: File[]) => Promise.resolve(files.map((_, index) => ({ id: `img-${index}`, kind: "image" }))),
      releasePromptAttachments: (ids: string[]) => { released.push(ids); return Promise.resolve(); } } } });
    host.calls = [];
    await saveAsTemplate();
    expect(host.calls.find((call) => call.type === "image.template.create")?.payload).toEqual({ projectId: "p", revision: 1 });
    expect(useImageWorkbench.getState().view).toEqual({ kind: "project", projectId: "p-template" });
    const document = useImageProject.getState().document!;
    const template = { ...document, template: { slots: ["t"] }, objects: [{ ...document.objects[0]!, kind: "text", text: "春日", font_size: 20, color: "#000000", align: "left", line_height: 1.2 } as never, document.objects[1]!] };
    await toggleTemplateSlot(template, "u");
    expect(edits().at(-1)?.operations).toEqual([{ type: "set_template", slots: ["t", "u"] }]);
    useImageProject.setState({ document: template });
    const made = await createFromTemplate({ title: "夏日", texts: { t: "春日", u: "x" }, images: { u: new File([new Uint8Array(4)], "new.png") } });
    const call = host.calls.find((item) => item.type === "image.template.instantiate")!.payload;
    // Unchanged words are not sent; only text layers carry words; pictures go by staged id.
    expect(call).toMatchObject({ templateId: "p", title: "夏日", texts: [], images: [{ layer: "u", attachmentId: "img-0" }] });
    expect(made).toBe(call.projectId);
    expect(released).toEqual([["img-0"]]);
    expect(await createFromTemplate({ title: "放不下", texts: {}, images: {} })).toBeUndefined();
    expect(notices.at(-1)).toMatchObject({ level: "warning", title: "没能从模板新建" });
    vi.unstubAllGlobals();
  });

  it("offers the revision and its sizes to the team hand-off, checked and rendered only on 发送", async () => {
    const { handOffImages, useImageTextChecks } = await import("./image-project-export.js");
    const { useTeamChatDialogStore } = await import("../team-chat/team-chat-dialog-store.js");
    useImageWorkbench.setState({ projects: [] });
    host.calls = [];
    handOffImages();
    const source = useTeamChatDialogStore.getState().handoff!;
    expect(source).toMatchObject({ title: "海报", images: { labels: ["100×100（原尺寸）"] } });
    expect(host.calls.some((call) => call.type === "image.project.render")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })));
    const pictures = await source.images!.prepare();
    expect(pictures?.map((picture) => [picture.file.name, picture.file.type, picture.size])).toEqual([["海报 100×100.png", "image/png", { width: 100, height: 100 }]]);
    expect(host.calls.map((call) => call.type)).toEqual(["image.project.checkText", "image.project.render"]);
    // Stopped at the text check, nothing is rendered and nothing is sent.
    host.unreadNext = true; host.calls = [];
    const stopped = source.images!.prepare();
    await vi.waitFor(() => expect(useImageTextChecks.getState().pending).toBeDefined());
    expect(useImageTextChecks.getState().pending?.purpose).toBe("handoff");
    // An export pressed meanwhile waits its turn instead of taking over the check.
    await exportImageProject();
    expect(useImageTextChecks.getState().pending?.purpose).toBe("handoff");
    useImageTextChecks.getState().pending!.decide(false);
    expect(await stopped).toBeUndefined();
    expect(host.calls.some((call) => call.type === "image.project.render")).toBe(false);
    // A picture over Team Chat's 25 MB limit is refused before anything is sent.
    host.unreadNext = false;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(26 * 1024 * 1024), { status: 200 })));
    await expect(source.images!.prepare()).rejects.toThrow(/超过 25 MB/u);
    useTeamChatDialogStore.getState().close();
    vi.unstubAllGlobals();
  });

  it("edits the brand kit on the version shown, stages its files, and reloads a stale view", async () => {
    const { loadBrand, editBrand, addBrandFile, useImageBrand } = await import("./image-brand.js");
    host.brand = { schema: "newmoney.image-brand.v1", revision: 0, colors: [], fonts: [], logos: [], specs: [] };
    await loadBrand();
    expect(await editBrand("添加颜色", [{ type: "set_color", color: { id: "color-1", name: "红", value: "#b5452f" } }])).toBe(true);
    expect(useImageBrand.getState().kit?.revision).toBe(1);
    const released: string[][] = [];
    vi.stubGlobal("window", { pi67: { system: { stagePromptAttachments: () => Promise.resolve([{ id: "f1", kind: "file" }]),
      releasePromptAttachments: (ids: string[]) => { released.push(ids); return Promise.resolve(); } } } });
    expect(await addBrandFile(new File([new Uint8Array(4)], "Brand.ttf"), "font")).toBe(true);
    expect(host.calls.find((call) => call.type === "image.brand.addFont")?.payload).toEqual({ baseRevision: 1, attachmentId: "f1" });
    expect(released).toEqual([["f1"]]);
    // Someone else edited meanwhile: the kit reloads and the person is told to try again.
    host.brand = { ...host.brand, revision: 9 };
    expect(await editBrand("移除颜色", [{ type: "remove_color", id: "color-1" }])).toBe(false);
    expect(notices.at(-1)).toMatchObject({ title: "品牌库刚被更新" });
    expect(useImageBrand.getState().kit?.revision).toBe(9);
    vi.unstubAllGlobals();
  });

  it("uses a brand font on a layer and inserts a brand logo, selected, on the revision shown", async () => {
    const { useBrandFontOn, insertBrandLogo } = await import("./image-brand.js");
    host.calls = [];
    expect(await useBrandFontOn("t", "font-1")).toBe(true);
    expect(host.calls.find((call) => call.type === "image.project.useBrandFont")?.payload).toEqual({ projectId: "p", baseRevision: 1, fontId: "font-1", objectId: "t" });
    expect(await insertBrandLogo("logo-1")).toBe(true);
    expect(host.calls.find((call) => call.type === "image.project.addBrandLogo")?.payload).toEqual({ projectId: "p", baseRevision: 2, logoId: "logo-1" });
    expect(useImageProject.getState().selectedObjectIds).toEqual(["logo"]);
    // Each is one undo step back to the revision it was made on.
    expect(useImageProject.getState().back.slice(-2)).toEqual([1, 2]);
    expect(await insertBrandLogo("gone")).toBe(false);
    expect(notices.at(-1)).toMatchObject({ title: "没能插入 Logo" });
    expect(await useBrandFontOn("t", "stale")).toBe(false);
    expect(notices.at(-1)).toMatchObject({ title: "没能使用品牌字体", message: "项目刚被更新，请再添加一次。" });
  });

  it("never offers a kit read from another creative library", async () => {
    const { loadBrand, offeredKit, useImageBrand } = await import("./image-brand.js");
    host.brand = { schema: "newmoney.image-brand.v1", revision: 1, colors: [], fonts: [], logos: [], specs: [] };
    await loadBrand();
    expect(offeredKit(useImageBrand.getState(), "lib")?.revision).toBe(1);
    expect(offeredKit(useImageBrand.getState(), "other")).toBeUndefined();
  });


});
