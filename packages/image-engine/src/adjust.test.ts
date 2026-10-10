import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createProject, editBatch, readProject } from "./project.js";
import { renderProject } from "./render.js";
import { deriveProject } from "./derive-project.js";
import { SCHEMA, SCHEMA_V3, validateDocument } from "./document.js";
import { tempDirectory } from "./test-support/harness.js";

// P4 checkpoint 6: brightness, contrast, saturation and blur on image layers, drawn
// through satori's CSS filters; the asset's own pixels never change.

async function project() {
  const directory = await tempDirectory("image-engine-调整-");
  const root = path.join(directory, "poster");
  await createProject(root, { project_id: "poster", title: "调整", canvas: { width: 200, height: 100, background: "#ffffff" }, assets: [],
    objects: [{ id: "paper", kind: "rect", locked: false, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1, color: "#ffffff", radius: 0 }] });
  // Left half orange, right half blue.
  const photo = path.join(directory, "photo.png");
  await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .composite([{ input: { create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } } }, left: 100, top: 0 }]).png().toFile(photo);
  await editBatch(root, { base_revision: 1, author: "agent", summary: "照片", operations: [{ type: "add_asset", asset: { id: "photo", source: photo } },
    { type: "add_object", object: { id: "shot", kind: "image", locked: false, visible: true, x: 0, y: 0, width: 200, height: 100, opacity: 1, asset_id: "photo", fit: "fill" } }] });
  return { directory, root };
}
async function pixels(root: string, directory: string, name: string) {
  await renderProject(root, path.join(directory, name));
  const { data, info } = await sharp(await fs.readFile(path.join(directory, name, "image.png"))).raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
}
const near = (actual: number[], expected: number[]) => actual.every((value, index) => Math.abs(value - expected[index]!) <= 3);
const adjust = (root: string, base: number, value: unknown) =>
  editBatch(root, { base_revision: base, author: "human", summary: "调整", operations: [{ type: "update_object", id: "shot", patch: { adjust: value } }] });

describe("image adjustments", { timeout: 120_000 }, () => {
  it("brightens, desaturates and blurs the layer, and writes v3 only while adjusted", async () => {
    const { directory, root } = await project();
    const brighter = await adjust(root, 2, { brightness: 1.5 });
    expect(brighter.document.schema).toBe(SCHEMA_V3);
    expect(near((await pixels(root, directory, "bright"))(40, 50), [255, 150, 75])).toBe(true);
    await adjust(root, 3, { saturation: 0, contrast: 1 });
    // The neutral contrast is not written.
    expect((await readProject(root)).document.objects[1]).toMatchObject({ adjust: { saturation: 0 } });
    let at = await pixels(root, directory, "grey");
    expect(at(40, 50)[0]).toBe(at(40, 50)[2]);
    await adjust(root, 4, { blur: 6 });
    at = await pixels(root, directory, "blur");
    expect(near(at(40, 50), [200, 100, 50])).toBe(true);
    const edge = at(100, 50);
    expect(edge[0]).toBeGreaterThan(20); expect(edge[0]).toBeLessThan(190);   // the halves bleed into each other
    // All neutral is no adjustment at all, and the document returns to v1.
    const plain = await adjust(root, 5, { blur: 0, brightness: 1 });
    expect(plain.document.objects[1]).not.toHaveProperty("adjust");
    expect(plain.document.schema).toBe(SCHEMA);
    await expect(adjust(root, 6, { saturation: 1 })).rejects.toThrow(/changes nothing on shot/u);
    // The same adjustments in another key order are no change either.
    await adjust(root, 6, { contrast: 1.2, brightness: 0.8 });
    await expect(adjust(root, 7, { brightness: 0.8, contrast: 1.2 })).rejects.toThrow(/changes nothing on shot/u);
  });

  it("derives a size whose blur scales to nothing as an older schema", async () => {
    const { directory, root } = await project();
    const faint = await adjust(root, 2, { blur: 0.05 });
    expect(faint.document.schema).toBe(SCHEMA_V3);
    const result = await deriveProject(root, path.join(directory, "small"), { revision: 3, sha256: faint.sha256, preset: "1x1", project_id: "small", title: "小" });
    expect(result.status).toBe("derived");
    const derived = (await readProject(path.join(directory, "small"))).document;
    expect(derived.objects[1]).not.toHaveProperty("adjust");
    expect(derived.schema).toBe(SCHEMA);
  });

  it("refuses values outside the ranges, neutral values written directly, and adjustments on other kinds", async () => {
    const { root } = await project();
    await expect(adjust(root, 2, { brightness: 3 })).rejects.toThrow(/adjust\.brightness/u);
    await expect(adjust(root, 2, { blur: -1 })).rejects.toThrow(/adjust\.blur/u);
    await expect(adjust(root, 2, { sharpen: 1 })).rejects.toThrow(/unsupported field sharpen/u);
    await expect(editBatch(root, { base_revision: 2, author: "agent", summary: "块", operations: [{ type: "add_object", object: {
      id: "box", kind: "rect", locked: false, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1, color: "#000000", radius: 0, adjust: { blur: 2 } } }] })).rejects.toThrow(/unsupported field adjust/u);
    // Even a neutral one: only an image's own optional fields are tidied away.
    await expect(editBatch(root, { base_revision: 2, author: "agent", summary: "块", operations: [{ type: "add_object", object: {
      id: "box", kind: "rect", locked: false, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1, color: "#000000", radius: 0, adjust: { brightness: 1 } } }] })).rejects.toThrow(/unsupported field adjust/u);
    const doc = (await adjust(root, 2, { contrast: 1.2 })).document;
    const withObject = (patch: object) => ({ ...doc, objects: [doc.objects[0], { ...doc.objects[1], ...patch }] });
    expect(() => validateDocument(withObject({ adjust: { contrast: 1 } }))).toThrow(/Write no adjust\.contrast/u);
    expect(() => validateDocument(withObject({ adjust: {} }))).toThrow(/Write no adjust instead/u);
  });
});
