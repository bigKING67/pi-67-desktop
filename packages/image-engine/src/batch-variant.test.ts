import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, editBatch, readProject } from "./project.js";
import { batchVariant, batchSummary } from "./batch-variant.js";
import { tempDirectory } from "./test-support/harness.js";

// P5 checkpoint 1: one table row becomes a one-revision sibling with the row's words.

const text = (id: string, words: string, y: number, width = 300) =>
  ({ id, kind: "text", locked: false, visible: true, x: 20, y, width, height: 60, opacity: 1, text: words, font_size: 40, color: "#222222", align: "left", line_height: 1.2 });

async function source() {
  const directory = await tempDirectory("image-engine-批量-");
  const root = path.join(directory, "poster");
  const created = await createProject(root, { project_id: "poster", title: "春日茶礼", canvas: { width: 400, height: 300, background: "#ffffff" }, assets: [],
    objects: [text("title", "春日茶礼", 20), text("price", "¥199", 120, 160), { ...text("brand", "New Money", 200), locked: true }] });
  return { directory, root, sha256: created.sha256 };
}
const row = (sha256: string, n: number, texts: Record<string, string>) =>
  ({ revision: 1, sha256, project_id: `poster-batch-${n}`, title: `春日茶礼 · ${n}`, batch_id: "b1", row: n, texts });

describe("batch rows", { timeout: 120_000 }, () => {
  it("writes the row's words as a new project, fitting text that grew and leaving the source untouched", async () => {
    const { directory, root, sha256 } = await source();
    const made = await batchVariant(root, path.join(directory, "poster-batch-1"), row(sha256, 1, { title: "夏日冷萃", price: "¥1,299.00" }));
    expect(made).toMatchObject({ status: "created", project_id: "poster-batch-1", shrunk: ["price"] });
    const written = (await readProject(path.join(directory, "poster-batch-1"))).document;
    expect(written.objects.find((object) => object.id === "title")).toMatchObject({ text: "夏日冷萃", font_size: 40 });
    expect(written.objects.find((object) => object.id === "price")).toMatchObject({ text: "¥1,299.00" });
    expect(written.change.summary).toBe(batchSummary("b1", 1, "poster", 1));
    expect((await readProject(root)).document.revision).toBe(1);
  });

  it("refuses rows naming a missing or locked layer, a glyph no font has, or text that cannot fit, writing nothing", async () => {
    const { directory, root, sha256 } = await source();
    const refused = async (texts: Record<string, string>) => batchVariant(root, path.join(directory, "x"), row(sha256, 2, texts));
    expect(await refused({ subtitle: "x" })).toEqual({ status: "refused", reason: "没有叫「subtitle」的文字图层" });
    expect(await refused({ brand: "x" })).toEqual({ status: "refused", reason: "文字图层「brand」已锁定" });
    expect(await refused({ title: "春日𓀀" })).toEqual({ status: "refused", reason: "有字体里没有的字符" });
    expect(await refused({ price: "¥199 限时特惠 买一送一 再送一" })).toMatchObject({ status: "refused", reason: expect.stringMatching(/放不下/u) });
    await expect(readProject(path.join(directory, "x"))).rejects.toThrow();
    // A stale source binding is an input error, not a row refusal.
    await editBatch(root, { base_revision: 1, author: "human", summary: "改", operations: [{ type: "update_object", id: "title", patch: { text: "改" } }] });
    await expect(batchVariant(root, path.join(directory, "y"), { ...row(sha256, 3, { title: "x" }), revision: 2 })).rejects.toThrow(/Stale source binding/u);
  });
});
