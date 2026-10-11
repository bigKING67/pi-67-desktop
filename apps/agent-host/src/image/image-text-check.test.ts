import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createProject, editBatch, projectRoot } from "@pi67/image-engine";
import { ImageEngineHost } from "./image-engine-host.js";
import { ImageProjectWatcher } from "./image-project-watcher.js";
import { readImageTexts } from "../ocr-image-reader.js";

// P4 checkpoint 8 with the real bundled OCR: shown text is read back from the full-size
// render, so covered or clipped text fails while turned, mirrored and small text passes.

const text = (id: string, words: string, x: number, y: number, size: number) =>
  ({ id, kind: "text", locked: false, visible: true, x, y, width: 520, height: Math.ceil(size * 1.3), opacity: 1, text: words, font_size: size, color: "#222222", align: "left", line_height: 1.2 });

describe("keyed text check", { timeout: 120_000 }, () => {
  it("passes readable text, fails covered text and refuses without OCR", async () => {
    const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "image-text-")));
    onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
    const root = projectRoot(cwd, "poster");
    await fs.mkdir(path.dirname(root), { recursive: true });
    await createProject(root, { project_id: "poster", title: "核对", canvas: { width: 600, height: 560, background: "#f4efe6" }, assets: [], objects: [
      text("title", "春日茶礼 · 新品上市", 30, 20, 48), text("price", "¥199 限时 8 折", 30, 110, 40), text("small", "满 299 元包邮，七天无理由退换", 30, 190, 18),
      text("turned", "春日茶礼 · 新品上市", 40, 270, 40), text("mirrored", "SALE", 30, 360, 48), text("covered", "春日茶礼 · 新品上市", 30, 450, 48),
      { id: "cover", kind: "rect", locked: false, visible: true, x: 200, y: 440, width: 380, height: 80, opacity: 1, color: "#b5452f", radius: 0 }] });
    await editBatch(root, { base_revision: 1, author: "human", summary: "转", operations: [
      { type: "update_object", id: "turned", patch: { rotation: -12 } }, { type: "update_object", id: "mirrored", patch: { flip_x: true } }] });
    const ocrRoot = path.join(cwd, "ocr");
    const engine = (readTexts?: (images: readonly Buffer[]) => Promise<string[]>) => new ImageEngineHost({ workspaceRoot: () => cwd, emit: () => undefined,
      watcher: new ImageProjectWatcher({ emit: () => undefined, maxWorkspaces: 0 }), ...(readTexts ? { readTexts } : {}) });
    const result = await engine((images) => readImageTexts(ocrRoot, images)).execute("w1", { type: "image.project.checkText", payload: { projectId: "poster" } });
    expect(result.revision).toBe(2);
    expect(Object.fromEntries(result.texts.map((check) => [check.objectId, check.passed]))).toEqual({ title: true, price: true, small: true, turned: true, mirrored: true, covered: false });
    await expect(engine().execute("w1", { type: "image.project.checkText", payload: { projectId: "poster" } })).rejects.toThrow(/不能核对/u);
  });
});
