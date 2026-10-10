import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createPhotoProject, createProject, editBatch, readProject } from "./project.js";
import { deriveProject, presetCanvas, relayoutObjects } from "./derive-project.js";
import { renderProject } from "./render.js";
import type { ImageObject, SceneObject, TextObject } from "./document.js";
import { objectById, tempDirectory, tree } from "./test-support/harness.js";

const base = { locked: false, visible: true, opacity: 1 } as const;
const from = { width: 1080, height: 1670, background: "#f4efe6" };

describe("derive presets", () => {
  it("keeps the short edge and takes the other from the ratio", () => {
    expect(["1x1", "3x4", "4x5", "9x16", "16x9"].map((preset) => presetCanvas(from, preset as never)))
      .toEqual([[1080, 1080], [1080, 1440], [1080, 1350], [1080, 1920], [1920, 1080]].map(([width, height]) => ({ width, height, background: "#f4efe6" })));
  });

  it("spans bands across the new width and scales the rest around a proportional centre", () => {
    const objects: SceneObject[] = [
      { ...base, id: "photo", kind: "image", asset_id: "a", fit: "contain", x: 0, y: 320, width: 1080, height: 1350 },
      { ...base, id: "title", kind: "text", text: "春日茶礼", font_size: 64, color: "#222222", align: "left", line_height: 1.2, x: 40, y: 100, width: 600, height: 90 },
      { ...base, id: "badge", kind: "rect", color: "#b5452f", radius: 30, x: 900, y: 1500, width: 140, height: 80 }
    ];
    const to = presetCanvas(from, "16x9");
    const [photo, title, badge] = relayoutObjects(objects, from, to) as [ImageObject, TextObject, SceneObject & { radius: number }];
    // Portrait to landscape: the photo fits whole instead of being blown up and cut.
    expect(photo).toMatchObject({ x: 0, width: 1920, fit: "contain", y: 207, height: 873 });
    expect(relayoutObjects(objects, from, presetCanvas(from, "4x5"))[0]).toMatchObject({ fit: "cover" });
    expect(relayoutObjects(objects, from, presetCanvas(from, "1x1"))[0]).toMatchObject({ fit: "cover" });
    // A masked band scales as one piece, keeping its proportions and fit, so the mask stays on its pixels.
    const [masked] = relayoutObjects([{ ...objects[0]!, mask: { asset_id: "m" } } as SceneObject], from, to) as [ImageObject];
    expect(masked.fit).toBe("contain"); expect(masked.width / masked.height).toBeCloseTo(1080 / 1350, 2);
    // A blur in canvas pixels scales with the layout, and one that rounds away is dropped.
    const blurred = { ...objects[0]!, adjust: { blur: 10, contrast: 1.2 } } as SceneObject;
    expect(relayoutObjects([blurred], from, presetCanvas(from, "1x1"))[0]).toMatchObject({ adjust: { blur: 6.5, contrast: 1.2 } });   // 10 × 1080 / 1670
    expect(relayoutObjects([{ ...blurred, adjust: { blur: 0.04 } } as SceneObject], from, { width: 540, height: 675, background: "#ffffff" })[0]).not.toHaveProperty("adjust");
    const s = 1080 / 1670;
    expect(title).toMatchObject({ font_size: Math.round(64 * s), width: Math.round(600 * s), height: Math.round(90 * s) });
    // Its centre moves with the canvas: x by 1920/1080, y by 1080/1670.
    expect(title.x + title.width / 2).toBeCloseTo((40 + 300) * (1920 / 1080), -1);
    // Pushed back inside the canvas, never off it.
    expect(badge.x + badge.width).toBeLessThanOrEqual(1920);
    expect(badge.y + badge.height).toBeLessThanOrEqual(1080);
    expect(badge.radius).toBe(Math.round(30 * s));
  });
});

describe("derive project", { timeout: 180_000 }, () => {
  // A 640×1280 source to 16:9 (1138×640) scales elements by exactly 0.5.
  async function source() {
    const directory = await tempDirectory("image-engine-派生-");
    const photo = path.join(directory, "photo.png"), root = path.join(directory, "spring");
    await sharp({ create: { width: 640, height: 900, channels: 3, background: "#b98645" } }).png().toFile(photo);
    const created = await createPhotoProject(root, { project_id: "spring", source: photo, headline: "春日茶礼", brand: "品牌", canvas: { width: 640, height: 1280 } });
    return { directory, root, created };
  }
  const headline = async (root: string, base: number, patch: Record<string, unknown>) =>
    editBatch(root, { base_revision: base, author: "human", summary: "标题", operations: [{ type: "update_object", id: "headline", patch: { text: "春日茶礼", ...patch } }] });

  it("writes one re-laid revision beside the source, renders it, and leaves the source untouched", async () => {
    const { directory, root, created } = await source(), before = await tree(root);
    const target = path.join(directory, "spring-4x5");
    const result = await deriveProject(root, target, { revision: 1, sha256: created.sha256, preset: "4x5", project_id: "spring-4x5", title: "春日 · 4:5" });
    expect(result).toMatchObject({ status: "derived", canvas: { width: 640, height: 800 } });
    const derived = await readProject(target);
    expect(result.status === "derived" && result.sha256).toBe(derived.sha256);
    expect(derived.document).toMatchObject({ project_id: "spring-4x5", title: "春日 · 4:5", revision: 1, change: { author: "system", summary: "Derived from spring revision 1 for 4:5" } });
    expect(objectById(derived.document, "photo")).toMatchObject({ x: 0, width: 640, fit: "cover" });
    expect(derived.document.assets).toEqual(created.document.assets);
    const rendered = await renderProject(target, path.join(directory, "out"));
    expect(rendered.receipt.outputs?.png).toMatchObject({ width: 640, height: 800 });
    expect(await tree(root)).toEqual(before);
  });

  it("shrinks text that rounding pushed over its box, and refuses a size where even 70% overflows, writing nothing", async () => {
    const { directory, root } = await source();
    const tight = await headline(root, 1, { font_size: 63, width: 252, height: 80 });
    const shrunk = await deriveProject(root, path.join(directory, "wide"), { revision: 2, sha256: tight.sha256, preset: "16x9", project_id: "wide", title: "宽" });
    expect(shrunk).toMatchObject({ status: "derived", shrunk: ["headline"], canvas: { width: 1138, height: 640 } });
    expect(objectById((await readProject(path.join(directory, "wide"))).document, "headline")).toMatchObject({ font_size: 30, width: 126 });

    const tiny = await headline(root, 2, { font_size: 12, width: 50, height: 20 });
    const refused = await deriveProject(root, path.join(directory, "tiny"), { revision: 3, sha256: tiny.sha256, preset: "16x9", project_id: "tiny", title: "小" });
    expect(refused).toEqual({ status: "refused", preset: "16x9", reason: "文字「春日茶礼」在 1138×640 里放不下" });
    await expect(fs.stat(path.join(directory, "tiny"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a stale source binding, an existing target and an unknown preset", async () => {
    const { directory, root, created } = await source();
    await expect(deriveProject(root, path.join(directory, "x"), { revision: 1, sha256: "0".repeat(64), preset: "1x1", project_id: "x", title: "x" })).rejects.toThrow(/Stale source/u);
    await fs.mkdir(path.join(directory, "taken"));
    await expect(deriveProject(root, path.join(directory, "taken"), { revision: 1, sha256: created.sha256, preset: "1x1", project_id: "taken", title: "t" })).rejects.toThrow(/already exists/u);
    await expect(deriveProject(root, path.join(directory, "y"), { revision: 1, sha256: created.sha256, preset: "2x1", project_id: "y", title: "y" })).rejects.toThrow(/Unknown size preset/u);
  });

  it("refuses a size past the canvas limits instead of failing the call", async () => {
    const directory = await tempDirectory("image-engine-派生-");
    const root = path.join(directory, "big");
    const created = await createProject(root, { project_id: "big", title: "大", canvas: { width: 4096, height: 4096, background: "#ffffff" }, assets: [],
      objects: [{ id: "block", kind: "rect", locked: false, visible: true, x: 0, y: 0, width: 4096, height: 4096, opacity: 1, color: "#b5452f", radius: 0 }] });
    expect(await deriveProject(root, path.join(directory, "wide"), { revision: 1, sha256: created.sha256, preset: "16x9", project_id: "wide", title: "宽" }))
      .toEqual({ status: "refused", preset: "16x9", reason: "7282×4096 超出画布上限（单边 8192、总计 1677 万像素）" });
    await expect(fs.stat(path.join(directory, "wide"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
