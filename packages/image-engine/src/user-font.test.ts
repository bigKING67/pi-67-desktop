import * as fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, editBatch, readProject } from "./project.js";
import { parseFont } from "./font-parse.js";
import { renderProject } from "./render.js";
import { deriveProject } from "./derive-project.js";
import { SCHEMA, SCHEMA_V2, validateDocument } from "./document.js";
import { fontManifest, fontDirectory } from "./font.js";
import { tempDirectory } from "./test-support/harness.js";

const latinFont = path.join(import.meta.dirname, "test-support/fonts/KaTeX_SansSerif-Regular.ttf");

describe("font parser", () => {
  it("reads the family, glyphs and advances of TrueType and OpenType fonts", async () => {
    const latin = parseFont(await fs.readFile(latinFont));
    expect(latin).toMatchObject({ format: "ttf", family: "KaTeX_SansSerif" });
    expect(latin.glyph("A".codePointAt(0)!)).toBeGreaterThan(0);
    expect(latin.glyph("春".codePointAt(0)!)).toBe(0);
    expect(latin.advance(latin.glyph("A".codePointAt(0)!))).toBeCloseTo(0.667, 2);
    const pinned = parseFont(await fs.readFile(path.join(fontDirectory, fontManifest.file)));
    expect(pinned).toMatchObject({ format: "otf", family: "Noto Sans CJK SC" });
    expect(pinned.glyph("春".codePointAt(0)!)).toBeGreaterThan(0);
  });

  it("refuses collections, web fonts, truncated tables and oversized files before reading them", async () => {
    const bytes = await fs.readFile(latinFont);
    expect(() => parseFont(Buffer.from("ttcf\0\0\0\0\0\0\0\0", "latin1"))).toThrow(/collections are not supported/u);
    expect(() => parseFont(Buffer.concat([Buffer.from("wOF2", "latin1"), bytes.subarray(4)]))).toThrow(/not TrueType or OpenType/u);
    expect(() => parseFont(bytes.subarray(0, 400))).toThrow(/outside the file|truncated/u);
    expect(() => parseFont(Buffer.alloc(20_000_001))).toThrow(/size/u);
    // A table directory claiming a huge table must not be trusted.
    const lying = Buffer.from(bytes); lying.writeUInt32BE(0x7fffffff, 12 + 12);
    expect(() => parseFont(lying)).toThrow(/outside the file/u);
  });
});

describe("user fonts in a project", { timeout: 180_000 }, () => {
  async function project() {
    const directory = await tempDirectory("image-engine-字体-");
    const root = path.join(directory, "poster");
    await createProject(root, { project_id: "poster", title: "字体", canvas: { width: 640, height: 320, background: "#ffffff" }, assets: [],
      objects: [{ id: "headline", kind: "text", locked: false, visible: true, x: 20, y: 20, width: 600, height: 120, opacity: 1, text: "春日 SALE", font_size: 64, color: "#222222", align: "left", line_height: 1.2 }] });
    const font = path.join(directory, "latin.ttf");
    await fs.copyFile(latinFont, font);
    return { directory, root, font };
  }

  it("binds a font, sets it on text with CJK falling back to the pinned font, renders differently, and writes v2 only while used", async () => {
    const { directory, root, font } = await project();
    const plain = await renderProject(root, path.join(directory, "plain"));
    // Without an id the engine names it; a dry run shows what it would bind.
    const named = await editBatch(root, { base_revision: 1, author: "human", summary: "添加字体", operations: [{ type: "add_font", font: { source: font } }] }, { dryRun: true });
    expect(named.document.fonts?.[0]?.id).toBe("font-1");
    const added = await editBatch(root, { base_revision: 1, author: "human", summary: "添加字体", operations: [{ type: "add_font", font: { id: "brand", source: font } }] });
    expect(added.document.schema).toBe(SCHEMA_V2);
    expect(added.document.fonts).toEqual([expect.objectContaining({ id: "brand", family: "KaTeX_SansSerif", format: "ttf" })]);
    const set = await editBatch(root, { base_revision: 2, author: "human", summary: "用品牌字体", operations: [{ type: "update_object", id: "headline", patch: { font_id: "brand" } }] });
    expect(set.document.objects[0]).toMatchObject({ font_id: "brand" });
    const styled = await renderProject(root, path.join(directory, "styled"));
    expect(styled.receipt.outputs?.png.sha256).not.toBe(plain.receipt.outputs?.png.sha256);
    const reopened = await readProject(root);
    expect([...reopened.fonts.keys()]).toEqual(["brand"]);
    const cleared = await editBatch(root, { base_revision: 3, author: "human", summary: "默认字体", operations: [{ type: "update_object", id: "headline", patch: { font_id: null } }] });
    expect(cleared.document.objects[0]).not.toHaveProperty("font_id");
    // Still bound, so still v2; a document with neither stays v1.
    expect(cleared.document.schema).toBe(SCHEMA_V2);
    expect((await readProject(root, { revision: 1 })).document.schema).toBe(SCHEMA);
  });

  it("refuses characters no loaded font has, duplicates, unknown fonts and fonts on v1 documents", async () => {
    const { root, font } = await project();
    await editBatch(root, { base_revision: 1, author: "human", summary: "添加字体", operations: [{ type: "add_font", font: { id: "brand", source: font } }] });
    await expect(editBatch(root, { base_revision: 2, author: "human", summary: "再加", operations: [{ type: "add_font", font: { id: "again", source: font } }] })).rejects.toThrow(/already added as brand/u);
    await expect(editBatch(root, { base_revision: 2, author: "human", summary: "未知", operations: [{ type: "update_object", id: "headline", patch: { font_id: "nope" } }] })).rejects.toThrow(/Missing font for headline/u);
    await expect(editBatch(root, { base_revision: 2, author: "human", summary: "表情", operations: [{ type: "update_object", id: "headline", patch: { text: "春日 😀", font_id: "brand" } }] })).rejects.toThrow(/Missing font glyphs: U\+1F600/u);
    const v1 = (await readProject(root, { revision: 1 })).document, { fonts } = (await readProject(root)).document;
    expect(() => validateDocument({ ...v1, fonts })).toThrow(/v2 document schema/u);
  });

  it("carries bound fonts into a derived size", async () => {
    const { directory, root, font } = await project();
    await editBatch(root, { base_revision: 1, author: "human", summary: "添加字体", operations: [{ type: "add_font", font: { id: "brand", source: font } }] });
    const used = await editBatch(root, { base_revision: 2, author: "human", summary: "用字体", operations: [{ type: "update_object", id: "headline", patch: { font_id: "brand" } }] });
    const target = path.join(directory, "square");
    expect(await deriveProject(root, target, { revision: 3, sha256: used.sha256, preset: "1x1", project_id: "square", title: "方" })).toMatchObject({ status: "derived" });
    const derived = await readProject(target);
    expect(derived.document.fonts?.map((item) => item.id)).toEqual(["brand"]);
    expect((await renderProject(target, path.join(directory, "square-out"))).receipt.outputs?.png).toMatchObject({ width: 320, height: 320 });
  });
});
