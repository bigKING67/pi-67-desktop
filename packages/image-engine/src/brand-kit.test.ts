import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { brandFile, brandRoot, editBrand, readBrand } from "./brand-kit.js";
import { tempDirectory } from "./test-support/harness.js";

const FONT = path.join(import.meta.dirname, "test-support/fonts/KaTeX_SansSerif-Regular.ttf");

// P5 checkpoint 3: the library's brand kit — colours, fonts, logos, specs — as immutable versions.

describe("brand kit", { timeout: 60_000 }, () => {
  it("starts empty, publishes versions on the one it read, and keeps fonts and logos by digest", async () => {
    const cwd = await tempDirectory("image-engine-品牌-");
    expect(await readBrand(cwd)).toMatchObject({ revision: 0, colors: [], fonts: [], logos: [], specs: [] });
    const logo = path.join(cwd, "logo.png");
    await sharp({ create: { width: 120, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(logo);
    const fontSource = path.join(cwd, "brand.ttf");
    await fs.copyFile(FONT, fontSource);
    const first = await editBrand(cwd, { base_revision: 0, operations: [
      { type: "set_color", color: { id: "red", name: "品牌红", value: "#b5452f" } },
      { type: "set_spec", spec: { id: "tb", name: "淘宝主图", width: 800, height: 800, max_bytes: 3_000_000, background: "white" } },
      { type: "add_font", source: fontSource }, { type: "add_logo", name: "横版 Logo", source: logo }] });
    expect(first).toMatchObject({ revision: 1, colors: [{ id: "red", value: "#b5452f" }], specs: [{ id: "tb", max_bytes: 3_000_000, background: "white" }],
      fonts: [{ id: "font-1", family: "KaTeX_SansSerif", format: "ttf" }], logos: [{ id: "logo-1", name: "横版 Logo", width: 120, height: 40 }] });
    expect(await fs.readFile(await brandFile(cwd, first.fonts[0]!.file, first.fonts[0]!.sha256))).toHaveLength(first.fonts[0]!.bytes);
    expect(await brandFile(cwd, first.logos[0]!.render_file, first.logos[0]!.render_sha256)).toBe(path.join(brandRoot(cwd), first.logos[0]!.render_file));
    // Editing a colour replaces it by id; a writer on an older version gets a conflict.
    const second = await editBrand(cwd, { base_revision: 1, operations: [{ type: "set_color", color: { id: "red", name: "品牌红", value: "#a03020" } }, { type: "remove_spec", id: "tb" }] });
    expect(second).toMatchObject({ revision: 2, colors: [{ value: "#a03020" }], specs: [] });
    await expect(editBrand(cwd, { base_revision: 1, operations: [{ type: "remove_color", id: "red" }] })).rejects.toThrow(/Brand conflict/u);
    expect((await readBrand(cwd)).revision).toBe(2);
  });

  it("refuses bad colours, specs past the canvas limit, duplicates and unknown items", async () => {
    const cwd = await tempDirectory("image-engine-品牌坏-");
    const edit = (operations: unknown[]) => editBrand(cwd, { base_revision: 0, operations });
    await expect(edit([{ type: "set_color", color: { id: "x", name: "x", value: "red" } }])).rejects.toThrow();
    await expect(edit([{ type: "set_spec", spec: { id: "s", name: "巨幅", width: 8192, height: 8192 } }])).rejects.toThrow(/canvas limit/u);
    await expect(edit([{ type: "set_spec", spec: { id: "s", name: "透明", width: 800, height: 800, background: "transparent" } }])).rejects.toThrow(/background/u);
    await expect(edit([{ type: "remove_logo", id: "logo-1" }])).rejects.toThrow(/Unknown brand item/u);
    await expect(edit([{ type: "set_color", color: { id: "x", name: " ", value: "#000000" } }])).rejects.toThrow(/needs a name/u);
    const font = path.join(cwd, "f.ttf");
    await fs.copyFile(FONT, font);
    await expect(edit([{ type: "add_font", source: font }, { type: "add_font", source: font }])).rejects.toThrow(/already in the brand kit/u);
  });
});
