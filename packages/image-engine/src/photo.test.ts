import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createPhotoProject, readProject, editBatch } from "./project.js";
import { renderProject } from "./render.js";
import { cropPhoto } from "./photo-crop.js";
import { sha256 } from "./content-store.js";
import type { ImageDocument, JsonRecord, SceneObject, TextObject } from "./document.js";
import type { PhotoBrief } from "./photo-templates.js";
import { objectById, tempDirectory, tree } from "./test-support/harness.js";

async function fixture(): Promise<{ directory: string; root: string; source: string; brief: PhotoBrief }> {
  const directory = await tempDirectory("image-engine-photo-");
  const source = path.join(directory, "商品 原图.png");
  const rgb = Buffer.from(Array.from({ length: 96 * 64 * 3 }, (_, i) => (i * 19 + Math.floor(i / 71)) % 256));
  await sharp(rgb, { raw: { width: 96, height: 64, channels: 3 } }).png().toFile(source);
  const brief: PhotoBrief = { project_id: "photo-test", source, headline: "光与影", brand: "品牌", caption: "产品视觉探索", canvas: { width: 640, height: 800 } };
  return { directory, root: path.join(directory, "新工程"), source, brief };
}
async function photoPixels(png: string | Buffer, photo: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  return sharp(png).extract({ left: photo.x, top: photo.y, width: photo.width, height: photo.height }).ensureAlpha().raw().toBuffer();
}
const batch = (base_revision: number, operations: JsonRecord[]): JsonRecord => ({ base_revision, author: "human", summary: "Photo workflow test", operations });
const photoOf = (doc: ImageDocument): SceneObject => objectById(doc, "photo");

describe("photo projects", { timeout: 180_000 }, () => {
  it("dry-run writes nothing and predicts the created document; source may be removed after creation", async () => {
    const { directory, root, source, brief } = await fixture();
    const before = await tree(directory);
    const planned = await createPhotoProject(root, brief, { dryRun: true });
    expect(planned.dry_run).toBe(true);
    expect(await tree(directory)).toEqual(before);
    const created = await createPhotoProject(root, brief);
    expect(created.sha256).toBe(planned.sha256);
    expect(created.document).toEqual(planned.document);
    expect(created.document.title).toBe(brief.project_id);
    const asset = created.document.assets[0];
    expect(await fs.readFile(path.join(root, asset?.file ?? ""))).toEqual(await fs.readFile(source));
    expect(created.document.objects.map((o) => o.id)).toEqual(["photo", "brand", "headline", "caption"]);
    expect(created.document.objects[0]?.locked).toBe(true);
    await fs.rm(source);
    const moved = path.join(directory, "迁移工程");
    await fs.rename(root, moved);
    expect((await readProject(moved)).sha256).toBe(created.sha256);
  });

  it("native photo pixels survive render, independent text edit and undo exactly", async () => {
    const { directory, root, brief } = await fixture();
    await createPhotoProject(root, brief);
    const initial = await readProject(root);
    const photo = photoOf(initial.document);
    const normalized = await sharp(path.join(root, initial.document.assets[0]?.render_file ?? "")).ensureAlpha().raw().toBuffer();
    const render = async (name: string): Promise<Buffer> => {
      const output = path.join(directory, name);
      await renderProject(root, output);
      const png = await fs.readFile(path.join(output, "image.png"));
      expect(await photoPixels(png, photo)).toEqual(normalized);
      return png;
    };
    const first = await render("initial");
    const before = await tree(root);
    await expect(editBatch(root, batch(1, [{ type: "update_object", id: "photo", patch: { x: 1 } }]))).rejects.toThrow(/locked/);
    expect(await tree(root)).toEqual(before);
    await editBatch(root, batch(1, [{ type: "update_object", id: "headline", patch: { text: "看见光" } }]));
    expect(sha256(await render("edited"))).not.toBe(sha256(first));
    await editBatch(root, batch(2, [{ type: "revert_to", revision: 1 }]));
    expect(await render("undone")).toEqual(first);
    const reopened = await readProject(root);
    expect(reopened.document.revision).toBe(3);
    expect(reopened.document.objects[0]?.locked).toBe(true);
  });

  it("one photo project retains native pixels across square and portrait revisions, relocking and undo", async () => {
    const { directory, root, brief } = await fixture();
    const created = await createPhotoProject(root, brief);
    const original = created.document;
    const photo = photoOf(original);
    const source = await sharp(path.join(root, original.assets[0]?.render_file ?? "")).ensureAlpha().raw().toBuffer();
    const edit = async (operations: JsonRecord[]) => {
      const current = await readProject(root), before = await tree(root);
      const spec = batch(current.document.revision, operations);
      const planned = await editBatch(root, spec, { dryRun: true });
      expect(await tree(root)).toEqual(before);
      const result = await editBatch(root, spec);
      expect(result.sha256).toBe(planned.sha256);
      return result;
    };
    const lock = (locked: boolean) => edit([{ type: "update_object", id: "photo", patch: { locked } }]);
    const renders: { revision: number; sha256: string }[] = [];
    const render = async (name: string): Promise<void> => {
      const current = await readProject(root);
      const object = photoOf(current.document);
      expect(object.locked).toBe(true);
      const result = await renderProject(root, path.join(directory, name));
      const png = await fs.readFile(path.join(result.output, "image.png"));
      expect(await photoPixels(png, object)).toEqual(source);
      renders.push({ revision: current.document.revision, sha256: result.receipt.outputs?.png.sha256 ?? "" });
    };
    await render("4x5");
    for (const [name, width, height] of [["square", 640, 640], ["9x16", 648, 1152]] as const) {
      const left = Math.floor(width / 16), offset = Math.floor((height - 320 - photo.height) / 2);
      const operations: JsonRecord[] = [
        { type: "set_canvas", canvas: { width, height, background: original.canvas.background } },
        { type: "update_object", id: "photo", patch: { x: Math.floor((width - photo.width) / 2), y: offset + 320 } },
        ...original.objects.filter((object) => object.kind === "text").map((object) => ({ type: "update_object", id: object.id, patch: { x: left, y: object.y + offset, width: width - 2 * left } }))
      ];
      const before = await tree(root);
      await expect(editBatch(root, batch((await readProject(root)).document.revision, operations))).rejects.toThrow(/locked/);
      expect(await tree(root)).toEqual(before);
      await lock(false);
      if (name === "square") {
        const unlocked = await tree(root), current = await readProject(root);
        for (const dryRun of [true, false]) {
          await expect(editBatch(root, batch(current.document.revision, [{ type: "set_canvas", canvas: { width: 80, height: 64, background: "#ffffff" } }]), { dryRun })).rejects.toThrow(/Invalid object\.|Object outside canvas/);
          expect(await tree(root)).toEqual(unlocked);
        }
        expect(photoOf((await readProject(root)).document).locked).toBe(false);
        await lock(true);
        expect(photoOf((await readProject(root)).document).locked).toBe(true);
        await lock(false);
      }
      await edit(operations);
      await lock(true);
      await render(name);
      const current = (await readProject(root)).document;
      expect(current.assets).toEqual(original.assets);
      expect(current.font).toEqual(original.font);
      for (const textObject of original.objects.filter((object): object is TextObject => object.kind === "text")) {
        const actual = objectById(current, textObject.id) as TextObject;
        for (const key of ["text", "font_size", "line_height", "color", "align"] as const) expect(actual[key]).toBe(textObject[key]);
      }
    }
    const beforeUndo = await tree(root), last = await readProject(root);
    for (const dryRun of [true, false]) {
      await expect(editBatch(root, batch(last.document.revision, [{ type: "revert_to", revision: 1 }]), { dryRun })).rejects.toThrow(/locked/);
      expect(await tree(root)).toEqual(beforeUndo);
    }
    await lock(false);
    await edit([{ type: "revert_to", revision: 1 }]);
    await lock(true);
    await render("restored");
    expect(renders.at(-1)?.sha256).toBe(renders[0]?.sha256);
    for (const item of renders) {
      const result = await renderProject(root, path.join(directory, `reopen-${item.revision}`), { revision: item.revision });
      expect(result.receipt.outputs?.png.sha256).toBe(item.sha256);
    }
  });

  it("minimal brief uses the default canvas; EXIF orientation keeps native size and original encoded bytes", async () => {
    const { directory, root, source } = await fixture();
    const rotated = path.join(directory, "oriented.jpg");
    await sharp(source).jpeg().withMetadata({ orientation: 6 }).toFile(rotated);
    const created = await createPhotoProject(root, { project_id: "minimal", source: rotated, headline: "光", title: "照片起稿" });
    expect(created.document.canvas).toEqual({ width: 1280, height: 1600, background: "#ffffff" });
    expect(created.document.objects).toHaveLength(2);
    const photo = photoOf(created.document);
    expect([photo.width, photo.height, photo.x, photo.y]).toEqual([64, 96, 608, 912]);
    expect(await fs.readFile(path.join(root, created.document.assets[0]?.file ?? ""))).toEqual(await fs.readFile(rotated));
    await renderProject(root, path.join(directory, "render"));
    const expected = await sharp(rotated).rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer();
    expect(await photoPixels(path.join(directory, "render/image.png"), photo)).toEqual(expected);
  });

  it("invalid briefs and text fail before publication in dry-run and create", async () => {
    const { directory, root, brief } = await fixture();
    const cases: [JsonRecord, RegExp][] = [
      [{ ...brief, unknown: true }, /unsupported field/], [{ ...brief, source: "relative.png" }, /absolute local path/],
      [{ ...brief, headline: "" }, /Invalid headline/], [{ ...brief, caption: null }, /Invalid caption/], [{ ...brief, canvas: null }, /must be an object/],
      [{ ...brief, canvas: { width: 639, height: 800 } }, /canvas.width/], [{ ...brief, canvas: { width: 8192, height: 8192 } }, /pixel limit/],
      [{ ...brief, headline: "文".repeat(100) }, /Text overflow: headline/], [{ ...brief, brand: "品牌".repeat(50) }, /Text overflow: brand/],
      [{ ...brief, caption: "说明".repeat(50) }, /Text overflow: caption/], [{ ...brief, headline: "\u{10ffff}" }, /glyph/i]
    ];
    const before = await tree(directory);
    for (const [input, pattern] of cases) for (const dryRun of [true, false]) await expect(createPhotoProject(root, input, { dryRun })).rejects.toThrow(pattern);
    expect(await tree(directory)).toEqual(before);
  });

  it("oversized and transparent sources are rejected; an explicit larger canvas preserves dimensions", async () => {
    const { directory, root, brief } = await fixture();
    const large = path.join(directory, "large.png"), alpha = path.join(directory, "alpha.png");
    await sharp({ create: { width: 641, height: 481, channels: 3, background: "#fefdfc" } }).png().toFile(large);
    await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.9 } } }).png().toFile(alpha);
    const before = await tree(directory);
    for (const dryRun of [true, false]) {
      await expect(createPhotoProject(root, { ...brief, source: large }, { dryRun })).rejects.toThrow(/No automatic resize or crop/);
      await expect(createPhotoProject(root, { ...brief, source: alpha }, { dryRun })).rejects.toThrow(/requires an opaque photo/);
    }
    expect(await tree(directory)).toEqual(before);
    const created = await createPhotoProject(root, { ...brief, source: large, canvas: { width: 641, height: 801 } });
    expect(created.layout.photo).toEqual({ x: 0, y: 320, width: 641, height: 481, scale: 1, cropped: false });
  });

  it("occupied destinations and symlinked sources do not alter any existing data", async () => {
    const { directory, root, source, brief } = await fixture();
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "keep.txt"), "existing user data");
    const link = path.join(directory, "source-link.png");
    await fs.symlink(source, link);
    const before = await tree(directory);
    for (const dryRun of [true, false]) {
      await expect(createPhotoProject(root, brief, { dryRun })).rejects.toThrow(/Project already exists/);
      await expect(createPhotoProject(path.join(directory, "new"), { ...brief, source: link }, { dryRun })).rejects.toThrow(/Symlink/);
    }
    expect(await tree(directory)).toEqual(before);
  });
});

describe("photo templates", { timeout: 180_000 }, () => {
  it("both templates preserve differently shaped photos and dry-run predicts publication", async () => {
    const dir = await tempDirectory("image-engine-template-");
    for (const [template, width, height] of [["brand-detail", 900, 1100], ["xiaohongshu-cover", 1100, 700]] as const) {
      const source = path.join(dir, `${template}.png`);
      const bytes = Buffer.from(Array.from({ length: width * height * 3 }, (_, i) => (i * 17 + Math.floor(i / 113)) % 256));
      await sharp(bytes, { raw: { width, height, channels: 3 } }).png().toFile(source);
      const root = path.join(dir, template), brief = { project_id: "template", source, headline: "让光停留，\n映见清透", brand: "GROLAND", template };
      const dry = await createPhotoProject(root, brief, { dryRun: true }); await expect(fs.stat(root)).rejects.toMatchObject({ code: "ENOENT" });
      const result = await createPhotoProject(root, brief); expect(result.sha256).toBe(dry.sha256);
      const layout = result.layout as { template: string; slot: { y: number; height: number }; photo: { scale: number } };
      expect(layout.template).toBe(template); expect(layout.photo.scale).toBe(1);
      const photo = photoOf(result.document); expect(photo.locked).toBe(true);
      expect(photo.x).toBe(Math.floor((result.document.canvas.width - width) / 2));
      expect(photo.y).toBe(layout.slot.y + Math.floor((layout.slot.height - height) / 2));
      await renderProject(root, path.join(dir, `${template}-export`));
      expect(await sharp(path.join(dir, `${template}-export/image.png`)).extract({ left: photo.x, top: photo.y, width, height }).removeAlpha().raw().toBuffer()).toEqual(bytes);
    }
  });

  it("invalid template, fit, copy and ratio fail before either dry-run or creation writes", async () => {
    const dir = await tempDirectory("image-engine-template-"), source = path.join(dir, "photo.png");
    await sharp({ create: { width: 1254, height: 1254, channels: 3, background: "#dab549" } }).png().toFile(source);
    const base: JsonRecord = { project_id: "t", source, headline: "标题", brand: "GROLAND", template: "brand-detail" };
    const cases: JsonRecord[] = [{ template: null }, { template: "missing" }, { brand: "" }, { caption: "unsupported" }, { canvas: { width: 1600, height: 1600 } }, { canvas: { width: 800, height: 1000 } }, { headline: "长".repeat(2000) }];
    for (const [i, patch] of cases.entries()) for (const dryRun of [true, false]) {
      const root = path.join(dir, `invalid-${i}-${dryRun}`);
      await expect(createPhotoProject(root, { ...base, ...patch }, { dryRun })).rejects.toThrow();
      await expect(fs.stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    }
    const { brand: _brand, ...missing } = base; await expect(createPhotoProject(path.join(dir, "missing"), missing)).rejects.toThrow(/brand/);
    const larger = await createPhotoProject(path.join(dir, "larger"), { ...base, canvas: { width: 1920, height: 2400 } }, { dryRun: true });
    expect(larger.document.canvas.width).toBe(1920); expect(larger.layout.photo.width).toBe(1254);
  });

  it("explicit canvas background and reported photo edges; defaults unchanged", async () => {
    const dir = await tempDirectory("image-engine-template-"), source = path.join(dir, "gradient.png"), width = 700, height = 600;
    // Vertical gradient #f6f6f6 -> #ffffff like a studio product shot.
    const bytes = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) { const v = 246 + Math.round(9 * y / (height - 1)); bytes.fill(v, y * width * 3, (y + 1) * width * 3); }
    await sharp(bytes, { raw: { width, height, channels: 3 } }).png().toFile(source);
    const base: JsonRecord = { project_id: "bg", source, headline: "轻透无瑕", brand: "CHANEL" };
    for (const template of ["brand-detail", "xiaohongshu-cover", undefined]) {
      const brief = template ? { ...base, template } : base;
      const plain = await createPhotoProject(path.join(dir, `plain-${template}`), brief, { dryRun: true });
      expect(plain.document.canvas.background).toBe(template ? "#f5f2eb" : "#ffffff");
      const white = await createPhotoProject(path.join(dir, `white-${template}`), { ...brief, background: "#ffffff" }, { dryRun: true });
      expect(white.document.canvas.background).toBe("#ffffff");
      expect(white.layout.photo_edges.top).toEqual({ mean: "#f6f6f6", spread: 0 });
      expect(white.layout.photo_edges.bottom).toEqual({ mean: "#ffffff", spread: 0 });
      expect(white.layout.photo_edges.left.spread).toBe(9);
    }
    await expect(createPhotoProject(path.join(dir, "bad"), { ...base, background: "white" }, { dryRun: true })).rejects.toThrow(/#RRGGBB/);
  });
});

describe("photo crop", { timeout: 60_000 }, () => {
  async function cropFixture() {
    const dir = await tempDirectory("image-engine-crop-");
    const source = path.join(dir, "source.png");
    const bytes = Buffer.from(Array.from({ length: 24 * 16 * 4 }, (_, i) => (i * 13) % 256));
    await sharp(bytes, { raw: { width: 24, height: 16, channels: 4 } }).png().toFile(source);
    return { dir, input: { source, source_sha256: sha256(await fs.readFile(source)), crop: { left: 3, top: 2, width: 12, height: 10 }, authorization: { user_approved: true, context: "User explicitly approved this rectangle" } } };
  }

  it("dry-run writes nothing and crop preserves alpha and original bytes with bound receipt", async () => {
    const { dir, input } = await cropFixture(), output = path.join(dir, "crop");
    const dry = await cropPhoto(output, input, { dryRun: true }); await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    const result = await cropPhoto(output, input); expect(result.receipt).toEqual(dry.receipt);
    expect(await fs.readFile(path.join(output, "original.png"))).toEqual(await fs.readFile(input.source));
    const expected = await sharp(input.source).extract(input.crop).ensureAlpha().raw().toBuffer();
    expect(await sharp(path.join(output, "cropped.png")).ensureAlpha().raw().toBuffer()).toEqual(expected);
    expect(sha256(expected)).toBe(result.receipt.qa.retained_rgba_sha256); expect(result.receipt.qa.product_completeness).toBe("UNVERIFIED");
    expect(sha256(await fs.readFile(path.join(output, "cropped.png")))).toBe(result.receipt.result.sha256);
  });

  it("authorization, identity, bounds, unknown fields, symlinks and existing output fail closed", async () => {
    const { dir, input } = await cropFixture();
    const cases: JsonRecord[] = [{ authorization: { user_approved: false, context: "no" } }, { authorization: undefined }, { source_sha256: "0".repeat(64) },
      { crop: { left: 23, top: 0, width: 2, height: 2 } }, { crop: { left: 0.5, top: 0, width: 1, height: 1 } }, { crop: { left: 0, top: 0, width: 0, height: 1 } },
      { crop: { left: -1, top: 0, width: 1, height: 1 } }, { crop: { ...input.crop, scale: 2 } }];
    for (const [i, patch] of cases.entries()) for (const dryRun of [true, false]) {
      const output = path.join(dir, `bad-${i}-${dryRun}`);
      await expect(cropPhoto(output, { ...input, ...patch }, { dryRun })).rejects.toThrow();
      await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    }
    const link = path.join(dir, "link.png"); await fs.symlink(input.source, link);
    await expect(cropPhoto(path.join(dir, "linked"), { ...input, source: link })).rejects.toThrow(/Symlink/);
    const output = path.join(dir, "existing"); await fs.mkdir(output); await fs.writeFile(path.join(output, "keep"), "keep");
    for (const dryRun of [true, false]) await expect(cropPhoto(output, input, { dryRun })).rejects.toThrow(/already exists/);
    expect(await fs.readFile(path.join(output, "keep"), "utf8")).toBe("keep");
    expect(sha256(await fs.readFile(input.source))).toBe(input.source_sha256);
  });

  it("coordinates bind to EXIF-oriented source and can include its bottom/right edge", async () => {
    const { dir, input } = await cropFixture(); const source = path.join(dir, "oriented.jpg");
    await sharp(input.source).removeAlpha().withMetadata({ orientation: 6 }).jpeg().toFile(source);
    const normalized = await sharp(source).rotate().toColourspace("srgb").png().toBuffer(); const meta = await sharp(normalized).metadata();
    expect(meta.width).toBe(16); expect(meta.height).toBe(24);
    const crop = { left: 8, top: 14, width: 8, height: 10 }, output = path.join(dir, "oriented");
    const result = await cropPhoto(output, { ...input, source, source_sha256: sha256(await fs.readFile(source)), crop });
    expect(result.receipt.source.width).toBe(16); expect(result.receipt.source.height).toBe(24);
    expect(await sharp(path.join(output, "cropped.png")).ensureAlpha().raw().toBuffer()).toEqual(await sharp(normalized).extract(crop).ensureAlpha().raw().toBuffer());
  });
});
