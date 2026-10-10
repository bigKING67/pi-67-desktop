import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createProject, editBatch, readProject } from "./project.js";
import { renderProject } from "./render.js";
import { SCHEMA, SCHEMA_V3, validateDocument } from "./document.js";
import { tempDirectory } from "./test-support/harness.js";

// P4 checkpoint 3: rotation and flip are render-time transforms about the box centre;
// the unrotated box stays on the canvas, and documents are v3 only while they use them.

const rect = (id: string, x: number, y: number, width: number, height: number, color: string) =>
  ({ id, kind: "rect", locked: false, visible: true, x, y, width, height, opacity: 1, color, radius: 0 });

async function project() {
  const directory = await tempDirectory("image-engine-旋转-");
  const root = path.join(directory, "poster");
  // A red bar across the middle with a blue cap on its left end, so flips and turns are visible.
  await createProject(root, { project_id: "poster", title: "旋转", canvas: { width: 200, height: 200, background: "#ffffff" }, assets: [],
    objects: [rect("bar", 50, 90, 100, 20, "#ff0000"), rect("cap", 50, 90, 20, 20, "#0000ff")] });
  return { directory, root };
}
async function pixels(root: string, directory: string, name: string) {
  const rendered = await renderProject(root, path.join(directory, name));
  const png = await fs.readFile(path.join(directory, name, "image.png"));
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  expect(rendered.receipt.outputs?.png).toMatchObject({ width: 200, height: 200 });
  return (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
}

describe("rotation and flip", { timeout: 120_000 }, () => {
  it("renders a 90° turn and a horizontal flip about the box centre, and writes v3 only while used", async () => {
    const { directory, root } = await project();
    const turned = await editBatch(root, { base_revision: 1, author: "human", summary: "旋转", operations: [{ type: "update_object", id: "bar", patch: { rotation: 90 } }] });
    expect(turned.document.schema).toBe(SCHEMA_V3);
    let at = await pixels(root, directory, "turned");
    expect(at(100, 60)).toEqual([255, 0, 0]);   // the bar now stands vertically through the centre
    expect(at(60, 100)).toEqual([0, 0, 255]);   // the cap was not turned
    expect(at(140, 100)).toEqual([255, 255, 255]);

    await editBatch(root, { base_revision: 2, author: "human", summary: "不旋转", operations: [{ type: "update_object", id: "bar", patch: { rotation: 0 } }] });
    const flipped = await editBatch(root, { base_revision: 3, author: "human", summary: "翻转", operations: [{ type: "update_object", id: "cap", patch: { flip_x: true, x: 130 } }] });
    expect(flipped.document.objects.find((object) => object.id === "bar")).not.toHaveProperty("rotation");
    at = await pixels(root, directory, "flipped");
    expect(at(140, 100)).toEqual([0, 0, 255]);

    const plain = await editBatch(root, { base_revision: 4, author: "human", summary: "还原", operations: [{ type: "update_object", id: "cap", patch: { flip_x: null } }] });
    expect(plain.document.objects.find((object) => object.id === "cap")).not.toHaveProperty("flip_x");
    expect(plain.document.schema).toBe(SCHEMA);
  });

  it("turns text about its declared box, not about its shorter natural height", async () => {
    const directory = await tempDirectory("image-engine-文字旋转-");
    const root = path.join(directory, "poster");
    // One short line at the top of a tall box: flipped top-to-bottom, the words must land at the bottom.
    await createProject(root, { project_id: "poster", title: "文字", canvas: { width: 200, height: 200, background: "#ffffff" }, assets: [],
      objects: [{ id: "words", kind: "text", locked: false, visible: true, x: 20, y: 20, width: 160, height: 160, opacity: 1, text: "■■■", font_size: 40, color: "#000000", align: "left", line_height: 1 }] });
    const ink = async (name: string) => {
      const at = await pixels(root, directory, name);
      let top = 0, bottom = 0;
      for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x += 2) if (at(x, y)[0]! < 100) { if (y < 100) top++; else bottom++; }
      return { top, bottom };
    };
    const before = await ink("upright");
    expect(before.top).toBeGreaterThan(0); expect(before.bottom).toBe(0);
    await editBatch(root, { base_revision: 1, author: "human", summary: "翻转", operations: [{ type: "update_object", id: "words", patch: { flip_y: true } }] });
    const after = await ink("flipped");
    expect(after.top).toBe(0); expect(after.bottom).toBeGreaterThan(0);
  });

  it("keeps the unrotated box as the canvas rule and refuses values outside the schema", async () => {
    const { root } = await project();
    // Turned 90°, a 100×20 box near the edge pokes out of the canvas; that is allowed and clipped.
    await expect(editBatch(root, { base_revision: 1, author: "human", summary: "贴边", operations: [{ type: "update_object", id: "bar", patch: { y: 0, rotation: 90 } }] })).resolves.toBeDefined();
    await expect(editBatch(root, { base_revision: 2, author: "human", summary: "超范围", operations: [{ type: "update_object", id: "bar", patch: { rotation: 270 } }] })).rejects.toThrow(/rotation/u);
    await expect(editBatch(root, { base_revision: 2, author: "human", summary: "坏值", operations: [{ type: "update_object", id: "bar", patch: { flip_y: "yes" } }] })).rejects.toThrow(/flip_y/u);
    // Optional fields written as "none" never publish an invisible revision, and a new object may say rotation 0.
    await expect(editBatch(root, { base_revision: 2, author: "human", summary: "无变化", operations: [{ type: "update_object", id: "cap", patch: { rotation: 0, flip_x: false } }] })).rejects.toThrow(/changes nothing on cap/u);
    const added = await editBatch(root, { base_revision: 2, author: "agent", summary: "加块", operations: [{ type: "add_object", object: { ...rect("dot", 0, 0, 10, 10, "#000000"), rotation: 0, flip_y: false } }] });
    expect(added.document.objects.find((object) => object.id === "dot")).not.toHaveProperty("rotation");
    const v1 = (await readProject(root, { revision: 1 })).document;
    expect(() => validateDocument({ ...v1, objects: v1.objects.map((object) => ({ ...object, rotation: 15 })) })).toThrow(/v3 document schema/u);
    expect(() => validateDocument({ ...v1, schema: SCHEMA_V3 })).toThrow(/must use an engine extension/u);
  });
});
