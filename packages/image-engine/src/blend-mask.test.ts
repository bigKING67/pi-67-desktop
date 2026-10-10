import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createProject, editBatch, readProject } from "./project.js";
import { renderProject } from "./render.js";
import { compose } from "./render-compose.js";
import { SCHEMA_V3 } from "./document.js";
import { tempDirectory } from "./test-support/harness.js";

// P4 checkpoint 5: satori drops blend modes and image masks, so objects that use them
// render as their own layers and resvg composites one assembled SVG.

const rect = (id: string, x: number, y: number, width: number, height: number, color: string) =>
  ({ id, kind: "rect", locked: false, visible: true, x, y, width, height, opacity: 1, color, radius: 0 });

async function project() {
  const directory = await tempDirectory("image-engine-混合-");
  const root = path.join(directory, "poster");
  await createProject(root, { project_id: "poster", title: "混合", canvas: { width: 200, height: 100, background: "#ffffff" }, assets: [],
    objects: [rect("base", 0, 0, 200, 100, "#0000ff"), rect("top", 0, 0, 200, 100, "#ff0000")] });
  // Left half white (shows), right half black (hides).
  const mask = path.join(directory, "mask.png");
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "#000000" } })
    .composite([{ input: { create: { width: 100, height: 100, channels: 3, background: "#ffffff" } }, left: 0, top: 0 }]).png().toFile(mask);
  await editBatch(root, { base_revision: 1, author: "agent", summary: "蒙版图", operations: [{ type: "add_asset", asset: { id: "half", source: mask } }] });
  return { directory, root };
}
async function pixels(root: string, directory: string, name: string) {
  await renderProject(root, path.join(directory, name));
  const { data, info } = await sharp(await fs.readFile(path.join(directory, name, "image.png"))).raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
}
const near = (actual: number[], expected: number[]) => actual.every((value, index) => Math.abs(value - expected[index]!) <= 3);

describe("blend modes and masks", { timeout: 120_000 }, () => {
  it("multiplies and screens a layer over what is below it", async () => {
    const { directory, root } = await project();
    const multiplied = await editBatch(root, { base_revision: 2, author: "human", summary: "正片叠底", operations: [{ type: "update_object", id: "top", patch: { blend: "multiply" } }] });
    expect(multiplied.document.schema).toBe(SCHEMA_V3);
    expect(near((await pixels(root, directory, "multiply"))(100, 50), [0, 0, 0])).toBe(true);
    await editBatch(root, { base_revision: 3, author: "human", summary: "滤色", operations: [{ type: "update_object", id: "top", patch: { blend: "screen" } }] });
    expect(near((await pixels(root, directory, "screen"))(100, 50), [255, 0, 255])).toBe(true);
  });

  it("shows a layer where its mask is white, inverted on request, and turns the mask with the object", async () => {
    const { directory, root } = await project();
    await editBatch(root, { base_revision: 2, author: "human", summary: "蒙版", operations: [{ type: "update_object", id: "top", patch: { mask: { asset_id: "half" } } }] });
    let at = await pixels(root, directory, "masked");
    expect(near(at(30, 50), [255, 0, 0])).toBe(true); expect(near(at(170, 50), [0, 0, 255])).toBe(true);
    await editBatch(root, { base_revision: 3, author: "human", summary: "反相", operations: [{ type: "update_object", id: "top", patch: { mask: { asset_id: "half", invert: true } } }] });
    at = await pixels(root, directory, "inverted");
    expect(near(at(30, 50), [0, 0, 255])).toBe(true); expect(near(at(170, 50), [255, 0, 0])).toBe(true);
    await editBatch(root, { base_revision: 4, author: "human", summary: "翻转", operations: [{ type: "update_object", id: "top", patch: { mask: { asset_id: "half" }, flip_x: true } }] });
    at = await pixels(root, directory, "flipped");
    expect(near(at(30, 50), [0, 0, 255])).toBe(true); expect(near(at(170, 50), [255, 0, 0])).toBe(true);
    // A transparent mask area hides; inverted, it shows.
    const holed = path.join(directory, "holed.png");
    await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }, left: 0, top: 0 }]).png().toFile(holed);
    await editBatch(root, { base_revision: 5, author: "agent", summary: "透明蒙版", operations: [{ type: "add_asset", asset: { id: "holed", source: holed } }] });
    await editBatch(root, { base_revision: 6, author: "human", summary: "透明反相", operations: [{ type: "update_object", id: "top", patch: { mask: { asset_id: "holed", invert: true }, flip_x: null } }] });
    at = await pixels(root, directory, "holed");
    expect(near(at(30, 50), [0, 0, 255])).toBe(true); expect(near(at(170, 50), [255, 0, 0])).toBe(true);
    await expect(editBatch(root, { base_revision: 7, author: "human", summary: "坏", operations: [{ type: "update_object", id: "top", patch: { mask: { asset_id: "nope" } } }] })).rejects.toThrow(/Missing mask asset/u);
  });

  it("keeps each layer's gradient its own when two layers each define one", async () => {
    const { directory, root } = await project();
    const gradient = (from: string, to: string) => ({ type: "linear", angle: 90, stops: [{ offset: 0, color: from }, { offset: 1, color: to }] });
    await editBatch(root, { base_revision: 2, author: "human", summary: "两层渐变", operations: [
      { type: "update_object", id: "base", patch: { gradient: gradient("#00ff00", "#00ff00") } },
      { type: "update_object", id: "top", patch: { gradient: gradient("#ff0000", "#ff0000"), blend: "lighten" } }] });
    // lighten(red, green) = yellow; a cross-wired id would draw one gradient twice.
    expect(near((await pixels(root, directory, "two"))(100, 50), [255, 255, 0])).toBe(true);
  });

  it("renders a document without blend or masks in one pass, as before", async () => {
    const { root } = await project();
    const state = await readProject(root);
    const { svg } = await compose({ root: state.root, font: state.font, fonts: state.fonts, document: state.document });
    expect(svg).not.toContain("xmlns:xlink");
    expect(svg).not.toContain("mix-blend-mode");
  });
});
