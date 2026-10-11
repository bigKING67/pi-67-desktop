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
