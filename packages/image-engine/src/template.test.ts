import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createProject, editBatch, readProject } from "./project.js";
import { SCHEMA, SCHEMA_V3, validateDocument } from "./document.js";
import { createTemplate, fromTemplateSummary, instantiateTemplate, templateSummary } from "./template.js";
import { batchVariant } from "./batch-variant.js";
import { tempDirectory } from "./test-support/harness.js";

// P5 checkpoint 2: templates mark replaceable layers; projects made from them change only those.

const text = (id: string, words: string, y: number) =>
  ({ id, kind: "text", locked: false, visible: true, x: 20, y, width: 300, height: 60, opacity: 1, text: words, font_size: 40, color: "#222222", align: "left", line_height: 1.2 });

async function setup() {
  const directory = await tempDirectory("image-engine-模板-");
  const root = path.join(directory, "poster");
  const photo = path.join(directory, "photo.png"), other = path.join(directory, "other.png");
  await sharp({ create: { width: 400, height: 300, channels: 3, background: "#d8c8b0" } }).png().toFile(photo);
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "#204060" } }).png().toFile(other);
  await createProject(root, { project_id: "poster", title: "春日茶礼", canvas: { width: 400, height: 300, background: "#ffffff" }, assets: [{ id: "photo", source: photo }],
    objects: [{ id: "photo", kind: "image", locked: true, visible: true, x: 0, y: 0, width: 400, height: 300, opacity: 1, asset_id: "photo", fit: "cover" },
      text("title", "春日茶礼", 20), text("price", "¥199", 120), { id: "band", kind: "rect", locked: false, visible: true, x: 0, y: 250, width: 400, height: 50, opacity: 1, color: "#b5452f", radius: 0 }] });
  return { directory, root, other, source: await readProject(root) };
}

describe("templates", { timeout: 120_000 }, () => {
  it("copies a revision as a template with every text and image layer as a slot, editable and removable", async () => {
    const { directory, source } = await setup();
    const root = path.join(directory, "poster-template");
    const made = await createTemplate(source, root, { project_id: "poster-template", title: "春日茶礼 · 模板" });
    expect(made.slots).toEqual(["photo", "title", "price"]);
    const written = (await readProject(root)).document;
    expect(written).toMatchObject({ schema: SCHEMA_V3, template: { slots: ["photo", "title", "price"] }, change: { summary: templateSummary("poster", 1) } });
    await editBatch(root, { base_revision: 1, author: "human", summary: "槽位", operations: [{ type: "set_template", slots: ["title", "price"] }] });
    // A removed slot's layer drops out by itself; a shape can never be a slot.
    const pruned = await editBatch(root, { base_revision: 2, author: "human", summary: "删", operations: [{ type: "remove_object", id: "price" }] });
    expect(pruned.document.template).toEqual({ slots: ["title"] });
    await expect(editBatch(root, { base_revision: 3, author: "human", summary: "坏", operations: [{ type: "set_template", slots: ["band"] }] })).rejects.toThrow(/not a text or image layer: band/u);
    // A misspelt layer is refused, never pruned away into a silent success.
    await expect(editBatch(root, { base_revision: 3, author: "human", summary: "错", operations: [{ type: "set_template", slots: ["titel"] }] })).rejects.toThrow(/Unknown template slot: titel/u);
    const plain = await editBatch(root, { base_revision: 3, author: "human", summary: "普通", operations: [{ type: "set_template", slots: null }] });
    expect(plain.document).not.toHaveProperty("template");
    expect(() => validateDocument({ ...plain.document, schema: SCHEMA, template: { slots: ["title"] } })).toThrow(/v3 document schema/u);
  });

  it("makes a plain project from a template: slot words and picture replaced, slots unlocked, every other layer locked", async () => {
    const { directory, source, other } = await setup();
    const templateRoot = path.join(directory, "t");
    await createTemplate(source, templateRoot, { project_id: "t", title: "模板" });
    const template = await readProject(templateRoot);
    const target = path.join(directory, "new");
    const made = await instantiateTemplate(template, target, { project_id: "new", title: "夏日冷萃", texts: { title: "夏日冷萃" }, images: { photo: other } });
    expect(made.status).toBe("created");
    const document = (await readProject(target)).document;
    expect(document).not.toHaveProperty("template");
    expect(document.change.summary).toBe(fromTemplateSummary("t", 1));
    expect(Object.fromEntries(document.objects.map((object) => [object.id, object.locked]))).toEqual({ photo: false, title: false, price: false, band: true });
    const photo = document.objects.find((object) => object.id === "photo");
    expect(photo).toMatchObject({ kind: "image", asset_id: "photo-image", fit: "cover", width: 400 });
    // The replaced picture is not carried along.
    expect(document.assets.map((asset) => asset.id)).toEqual(["photo-image"]);
    expect(document.assets.find((asset) => asset.id === "photo-image")).toMatchObject({ width: 200, height: 100 });
    // A layer that is not an image slot is refused before any picture is read.
    expect(await instantiateTemplate(template, path.join(directory, "w"), { project_id: "w", title: "w", texts: {}, images: { title: path.join(directory, "missing.png") } }))
      .toEqual({ status: "refused", reason: "没有叫「title」的图片图层" });
    expect(await instantiateTemplate(template, path.join(directory, "x"), { project_id: "x", title: "x", texts: { band: "x" }, images: {} }))
      .toEqual({ status: "refused", reason: "没有叫「band」的文字图层" });
    await editBatch(templateRoot, { base_revision: 1, author: "human", summary: "槽位", operations: [{ type: "set_template", slots: ["title"] }] });
    expect(await instantiateTemplate(await readProject(templateRoot), path.join(directory, "y"), { project_id: "y", title: "y", texts: { price: "¥1" }, images: {} }))
      .toEqual({ status: "refused", reason: "「price」不是这个模板的可替换图层" });
    await expect(instantiateTemplate(source, path.join(directory, "z"), { project_id: "z", title: "z", texts: {}, images: {} })).rejects.toThrow(/Not a template/u);
  });

  it("unlocks a slot that sits in a locked group of the template", async () => {
    const { directory, source } = await setup();
    const templateRoot = path.join(directory, "t");
    await createTemplate(source, templateRoot, { project_id: "t", title: "模板" });
    await editBatch(templateRoot, { base_revision: 1, author: "human", summary: "组", operations: [{ type: "group_objects", group: { id: "copy", name: "文案" }, ids: ["title", "price"] }] });
    await editBatch(templateRoot, { base_revision: 2, author: "human", summary: "锁", operations: [{ type: "update_group", id: "copy", patch: { locked: true } }] });
    await instantiateTemplate(await readProject(templateRoot), path.join(directory, "new"), { project_id: "new", title: "新", texts: {}, images: {} });
    const made = await readProject(path.join(directory, "new"));
    await expect(editBatch(path.join(directory, "new"), { base_revision: 1, author: "human", summary: "改", operations: [{ type: "update_object", id: "title", patch: { text: "夏日" } }] })).resolves.toBeDefined();
    expect(made.document.groups).toEqual([expect.objectContaining({ id: "copy", locked: false })]);
  });

  it("runs a batch on a template as instances: no template field, only slots unlocked", async () => {
    const { directory, source } = await setup();
    const templateRoot = path.join(directory, "t");
    await createTemplate(source, templateRoot, { project_id: "t", title: "模板" });
    await batchVariant(await readProject(templateRoot), path.join(directory, "row"), { project_id: "row", title: "行", batch_id: "b1", row: 1, texts: { price: "¥299" } });
    const row = (await readProject(path.join(directory, "row"))).document;
    expect(row).not.toHaveProperty("template");
    expect(row.objects.find((object) => object.id === "band")?.locked).toBe(true);
    expect(row.objects.find((object) => object.id === "price")).toMatchObject({ locked: false, text: "¥299" });
  });
});
