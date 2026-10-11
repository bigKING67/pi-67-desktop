import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createProject, editBatch, readProject } from "./project.js";
import { renderProject } from "./render.js";
import { checkKeyedText, textMatches } from "./text-check.js";
import { tempDirectory } from "./test-support/harness.js";

// P4 checkpoint 8: the engine crops each shown text and judges what an OCR read back.

describe("keyed text check", { timeout: 120_000 }, () => {
  it("judges letters and digits only, and needs every digit run exactly", () => {
    expect(textMatches("春日茶礼 · 新品上市", "春 日 茶 礼 , 新 品 上 市")).toBe(true);
    expect(textMatches("¥199", "#199")).toBe(true);
    expect(textMatches("¥199", "#189")).toBe(false);
    expect(textMatches("满 299 元包邮，七天无理由退换", "满 299 元 包 郎 , 七 天 无 理 由 退 换")).toBe(true);
    expect(textMatches("春日茶礼 · 新品上市", "春 日 茶 礼")).toBe(false);
    expect(textMatches("· · ·", "")).toBe(true);
    // Digits must be the digits written: no extra, none missing, even when the letters pass.
    expect(textMatches("¥199", "1199")).toBe(false);
    expect(textMatches("¥1,999", "¥1,999")).toBe(true);
  });

  it("measures each text's colour against what lies behind its box, at its opacity and over other layers", async () => {
    const directory = await tempDirectory("image-engine-对比-");
    const root = path.join(directory, "poster");
    const text = (id: string, x: number, y: number, color: string, size = 48, opacity = 1) =>
      ({ id, kind: "text", locked: false, visible: true, x, y, width: 500, height: Math.ceil(size * 1.3), opacity, text: "春日茶礼", font_size: size, color, align: "left", line_height: 1.2 });
    const band = (id: string, y: number) => ({ id, kind: "rect", locked: false, visible: true, x: 0, y, width: 1200, height: 100, opacity: 1, color: "#1d1d1d", radius: 0 });
    // 1200 short edge: 40px and up is large (3:1), smaller needs 4.5:1. Wider than 1024, so the background is measured scaled down.
    await createProject(root, { project_id: "poster", title: "对比", canvas: { width: 1600, height: 1200, background: "#ffffff" }, assets: [], objects: [
      text("dark", 20, 20, "#222222"), text("faint", 20, 100, "#e8e2d8"), text("faded", 20, 180, "#222222", 48, 0.12),
      text("justEnough", 20, 260, "#767676", 14), text("tooLight", 20, 300, "#8a8a8a", 14),
      // A faint subtitle laid over a dark headline: the headline never lends it contrast.
      text("headline", 600, 20, "#111111", 72), text("subtitle", 620, 40, "#eeeeee", 48),
      band("band", 400), text("onDark", 20, 420, "#ffffff"), band("band2", 560), text("onDarkGrey", 20, 580, "#333333")] });
    const out = path.join(directory, "out");
    const { receipt } = await renderProject(root, out, { textBackground: true });
    expect(receipt.outputs?.text_background).toMatchObject({ width: 1024, height: 768 });
    const png = await fs.readFile(path.join(out, "image.png")), background = await fs.readFile(path.join(out, "text-background.png"));
    const checks = await checkKeyedText(png, (await readProject(root)).document, async (images) => images.map(() => "春日茶礼"), background);
    const low = Object.fromEntries(checks.map((check) => [check.object_id, check.low_contrast]));
    expect(low).toEqual({ dark: false, faint: true, faded: true, justEnough: false, tooLight: true, headline: false, subtitle: true, onDark: false, onDarkGrey: true });
    // #767676 on white is 4.54:1, shown and judged as 4.5:1.
    expect(checks.find((check) => check.object_id === "justEnough")!.contrast).toBe(4.5);
    await expect(renderProject(root, path.join(directory, "small"), { textBackground: true, previewMax: 640 })).rejects.toThrow(/full size only/u);
  });

  it("crops every shown text from the render, skips hidden ones, and reports what was read", async () => {
    const directory = await tempDirectory("image-engine-读字-");
    const root = path.join(directory, "poster");
    const text = (id: string, words: string, y: number) => ({ id, kind: "text", locked: false, visible: true, x: 20, y, width: 300, height: 60, opacity: 1, text: words, font_size: 40, color: "#000000", align: "left", line_height: 1.2 });
    await createProject(root, { project_id: "poster", title: "读字", canvas: { width: 400, height: 300, background: "#ffffff" }, assets: [],
      objects: [text("title", "春日", 20), text("price", "¥199", 120), { ...text("hidden", "隐藏", 200), visible: false }] });
    await editBatch(root, { base_revision: 1, author: "human", summary: "转", operations: [{ type: "update_object", id: "price", patch: { rotation: 170 } }] });
    await renderProject(root, path.join(directory, "out"));
    const png = await fs.readFile(path.join(directory, "out", "image.png"));
    const sizes: { width?: number; height?: number }[] = [];
    const checks = await checkKeyedText(png, (await readProject(root)).document, async (images) => {
      for (const image of images) sizes.push(await sharp(image).metadata());
      return ["春 日", "#18"];
    });
    expect(checks).toEqual([
      { object_id: "title", text: "春日", read: "春 日", passed: true },
      { object_id: "price", text: "¥199", read: "#18", passed: false }
    ]);
    // The box and its margin; the price turned past 90° is cut back to its own box size too.
    expect(sizes[0]).toMatchObject({ width: 316, height: 76 });
    expect(sizes[1]).toMatchObject({ width: 316, height: 76 });
  });
});
