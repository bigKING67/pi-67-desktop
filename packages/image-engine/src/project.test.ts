import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { sha256 } from "./content-store.js";
import { LIMITS, type ImageDocument, type TextObject } from "./document.js";
import { createProject, readProject, editBatch, encode, importRaster } from "./project.js";
import { renderProject } from "./render.js";
import { demoInput, type DemoInput } from "./test-support/fixtures.js";
import { batch, objectById, pixels, readJson, tempDirectory, tree, update } from "./test-support/harness.js";

async function fixture(prepare: (input: DemoInput) => void = () => {}): Promise<{ directory: string; root: string; input: DemoInput }> {
  const directory = await tempDirectory("image-engine-");
  const input = await demoInput(path.join(directory, "source"));
  prepare(input);
  const root = path.join(directory, "project");
  await createProject(root, input);
  return { directory, root, input };
}
const text = (doc: ImageDocument, id: string): TextObject => objectById(doc, id) as TextObject;

describe("image project revisions", { timeout: 180_000 }, () => {
  it("create copies original assets and font; project reopens without input files", async () => {
    const { directory, root, input } = await fixture();
    const before = await readProject(root);
    await expect(createProject(root, input)).rejects.toThrow(/Project already exists/);
    expect((await readProject(root)).sha256).toBe(before.sha256);
    await fs.rm(path.join(directory, "source"), { recursive: true });
    expect((await readProject(root)).sha256).toBe(before.sha256);
    const moved = path.join(directory, "moved-project");
    await fs.rename(root, moved);
    expect((await readProject(moved)).sha256).toBe(before.sha256);
    const spec = { project_id: "x", title: "x", assets: [], canvas: before.document.canvas, objects: before.document.objects };
    await expect(createProject(moved, spec)).rejects.toThrow(/Project already exists/);
    const invalid = path.join(directory, "invalid-project");
    await expect(createProject(invalid, spec)).rejects.toThrow(/Missing asset/);
    await expect(fs.lstat(invalid)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readProject(moved)).sha256).toBe(before.sha256);
  });

  it("batch validation and dry-run do not publish revisions or imported assets", async () => {
    const { root, input } = await fixture();
    const before = await tree(root);
    const extra = { ...input.assets[1], id: "extra" };
    await expect(editBatch(root, batch(1, [{ type: "add_asset", asset: extra }, update("product", { x: 9999 })]))).rejects.toThrow(/Invalid object.x/);
    expect(await tree(root)).toEqual(before);
    const planned = await editBatch(root, batch(1, [{ type: "add_asset", asset: extra }, update("headline", { text: "中文改字" })]), { dryRun: true });
    expect(planned.document.revision).toBe(2);
    expect(planned.dry_run).toBe(true);
    expect(await tree(root)).toEqual(before);
  });

  it("edit preflight rejects text overflow before publishing any revision or new asset", async () => {
    const { root, directory } = await fixture();
    const before = await tree(root);
    const source = path.join(directory, "extra.png");
    await fs.writeFile(source, await sharp({ create: { width: 3, height: 3, channels: 3, background: "#123456" } }).png().toBuffer());
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ text: "标题".repeat(100) }, /Text overflow: headline/], [{ height: 10 }, /Text overflow: headline/], [{ width: 10 }, /narrower than glyph/],
      [{ font_size: 100 }, /Text overflow: headline/], [{ line_height: 2 }, /Text overflow: headline/]
    ];
    for (const [patch, error] of cases) for (const dryRun of [true, false]) {
      await expect(editBatch(root, batch(1, [{ type: "add_asset", asset: { id: "extra", source } }, update("headline", patch)]), { dryRun })).rejects.toThrow(error);
      expect(await tree(root)).toEqual(before);
    }
    expect((await readProject(root)).document.revision).toBe(1);
  });

  it("text preflight measures the final batch and visible objects with the render engine", async () => {
    const { root, directory } = await fixture();
    await editBatch(root, batch(1, [update("headline", { visible: false, height: 10 })]));
    const before = await tree(root);
    for (const dryRun of [true, false]) {
      await expect(editBatch(root, batch(2, [update("headline", { visible: true })]), { dryRun })).rejects.toThrow(/Text overflow: headline/);
      expect(await tree(root)).toEqual(before);
    }
    // An intermediate operation may overflow; only the complete batch is published.
    const repair = batch(2, [update("headline", { visible: true }), update("headline", { text: "春日焕新\n轻盈日常", height: 220 })]);
    const planned = await editBatch(root, repair, { dryRun: true });
    expect(await tree(root)).toEqual(before);
    const edited = await editBatch(root, repair);
    expect(edited.sha256).toBe(planned.sha256);
    const rendered = await renderProject(root, path.join(directory, "repaired"));
    const measurements = rendered.receipt.qa?.text_measurements as Record<string, { height: number }>;
    expect(measurements.headline?.height).toBe(180);
  });

  it("legacy overflowing text can be explicitly unlocked and repaired but not restored", async () => {
    const { root, directory } = await fixture((input) => Object.assign(objectById(input as unknown as ImageDocument, "headline"), { locked: true, height: 10 }));
    const unlock = batch(1, [update("headline", { locked: false })]);
    const before = await tree(root);
    const planned = await editBatch(root, unlock, { dryRun: true });
    expect(await tree(root)).toEqual(before);
    expect((await editBatch(root, unlock)).sha256).toBe(planned.sha256);
    await editBatch(root, batch(2, [update("headline", { height: 220 })]));
    const repaired = await tree(root);
    for (const dryRun of [true, false]) {
      await expect(editBatch(root, batch(3, [{ type: "revert_to", revision: 1 }]), { dryRun })).rejects.toThrow(/Text overflow: headline/);
      expect(await tree(root)).toEqual(repaired);
    }
    expect((await renderProject(root, path.join(directory, "repaired"))).receipt.status).toBe("completed");
  });

  it("stale edits fail; concurrent batches on one base have exactly one winner", async () => {
    const { root } = await fixture();
    const attempts = await Promise.allSettled([
      editBatch(root, batch(1, [update("price", { text: "¥139" })])),
      editBatch(root, batch(1, [update("price", { text: "¥149" })]))
    ]);
    expect(attempts.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((value) => value.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as Error).message).toMatch(/Revision conflict/);
    expect((await readProject(root)).document.revision).toBe(2);
    const before = await tree(root);
    await expect(editBatch(root, batch(1, [update("price", { text: "¥9" })]))).rejects.toThrow(/Revision conflict/);
    expect(await tree(root)).toEqual(before);
  });

  it("asset/object add, geometry edit, reordering, removal and canvas adaptation survive reopening", async () => {
    const { root, input } = await fixture();
    const current = (await readProject(root)).document;
    const copy = { ...objectById(current, "product"), id: "product-copy", asset_id: "product-copy", x: 100, width: 100, height: 200 };
    await editBatch(root, batch(1, [{ type: "add_asset", asset: { ...input.assets[1], id: "product-copy" } }, { type: "add_object", object: copy }]));
    const added = (await readProject(root)).document;
    expect((added.objects.at(-1) as { asset_id?: string }).asset_id).toBe("product-copy");
    expect(added.assets.at(-1)?.sha256).toBe(current.assets.find((asset) => asset.id === "product")?.sha256);
    const ids = added.objects.map((object) => object.id);
    [ids[2], ids[3]] = [ids[3] as string, ids[2] as string];
    await editBatch(root, batch(2, [{ type: "reorder_objects", ids }, { type: "remove_object", id: "product-copy" },
      { type: "set_canvas", canvas: { width: 960, height: 1200, background: "#ffffff" } }, update("background", { width: 960, height: 1200 }), update("footer", { y: 1135 })]));
    const reopened = (await readProject(root)).document;
    expect(reopened.objects[2]?.id).toBe("headline");
    expect(reopened.objects.some((object) => object.id === "product-copy")).toBe(false);
    expect([reopened.canvas.width, reopened.canvas.height]).toEqual([960, 1200]);
    expect(objectById(reopened, "footer").y).toBe(1135);
  });

  it("locks block edits/removal/reorder and cannot be bypassed in the same batch", async () => {
    const { root } = await fixture();
    await expect(editBatch(root, batch(1, [update("logo", { x: 1 })]))).rejects.toThrow(/locked/);
    await expect(editBatch(root, batch(1, [{ type: "remove_object", id: "logo" }]))).rejects.toThrow(/locked/);
    await expect(editBatch(root, batch(1, [update("logo", { locked: false }), update("logo", { x: 1 })]))).rejects.toThrow(/isolated/);
    await expect(editBatch(root, batch(1, [update("logo", { locked: false, x: 1 })]))).rejects.toThrow(/isolated/);
    const doc = (await readProject(root)).document;
    await expect(editBatch(root, batch(1, [{ type: "reorder_objects", ids: doc.objects.map((object) => object.id).reverse() }]))).rejects.toThrow(/locked/);
    await editBatch(root, batch(1, [update("logo", { locked: false })]));
    await editBatch(root, batch(2, [update("logo", { x: 10 })]));
    expect(objectById((await readProject(root)).document, "logo").x).toBe(10);
  });

  it("undo creates a new revision, keeps current locks and rejects reverting protected changes", async () => {
    const { root } = await fixture();
    await editBatch(root, batch(1, [update("price", { text: "¥139" })]));
    await editBatch(root, batch(2, [update("product", { locked: true })]));
    const undone = await editBatch(root, batch(3, [{ type: "revert_to", revision: 1 }]));
    expect(undone.document.revision).toBe(4);
    expect(text(undone.document, "price").text).toBe("¥129");
    expect(objectById(undone.document, "product").locked).toBe(true);
    await editBatch(root, batch(4, [update("product", { locked: false })]));
    await editBatch(root, batch(5, [update("product", { x: 570 })]));
    await editBatch(root, batch(6, [update("product", { locked: true })]));
    await expect(editBatch(root, batch(7, [{ type: "revert_to", revision: 1 }]))).rejects.toThrow(/Revert would change locked/);
    expect((await readProject(root)).document.revision).toBe(7);
  });

  it("undo cannot reorder a currently locked object; explicit unlock permits recovery", async () => {
    const { root } = await fixture();
    const original = (await readProject(root)).document.objects.map((object) => object.id);
    const reordered = [...original], a = original.indexOf("product"), b = original.indexOf("headline");
    [reordered[a], reordered[b]] = [original[b] as string, original[a] as string];
    await editBatch(root, batch(1, [{ type: "reorder_objects", ids: reordered }]));
    await editBatch(root, batch(2, [update("product", { locked: true })]));
    const before = await tree(root);
    await expect(editBatch(root, batch(3, [{ type: "reorder_objects", ids: original }]))).rejects.toThrow(/locked/);
    for (const dryRun of [true, false]) {
      await expect(editBatch(root, batch(3, [{ type: "revert_to", revision: 1 }]), { dryRun })).rejects.toThrow(/locked/);
      expect(await tree(root)).toEqual(before);
    }
    await editBatch(root, batch(3, [update("product", { locked: false })]));
    const restored = await editBatch(root, batch(4, [{ type: "revert_to", revision: 1 }]));
    expect(restored.document.objects.map((object) => object.id)).toEqual(original);
    expect(objectById(restored.document, "product").locked).toBe(false);
    expect((await readProject(root)).sha256).toBe(restored.sha256);
  });

  it("asset, font, ancestry and symlink tampering fail closed", async () => {
    for (const mode of ["asset", "font", "history", "symlink"]) {
      const { root } = await fixture();
      const doc = (await readProject(root)).document;
      if (mode === "history") {
        await editBatch(root, batch(1, [update("price", { text: "¥139" })]));
        const file = path.join(root, "revisions/000001.json");
        const previous = await readJson(file) as unknown as ImageDocument; text(previous, "price").text = "¥1";
        await fs.writeFile(file, encode(previous));
        await expect(readProject(root)).rejects.toThrow(/digest chain/);
      } else {
        const file = path.join(root, mode === "font" ? doc.font.file : doc.assets[0]?.file ?? "");
        if (mode === "symlink") {
          const copy = `${file}.copy`; await fs.rename(file, copy); await fs.symlink(copy, file);
          await expect(readProject(root)).rejects.toThrow(/Symlink/);
        } else {
          const handle = await fs.open(file, "r+"); await handle.write(Buffer.from([0]), 0, 1, 0); await handle.close();
          await expect(readProject(root)).rejects.toThrow(/digest mismatch/);
        }
      }
    }
  });

  it("untrusted raster boundary rejects URL/SVG/animation and preserves oriented JPEG originals", async () => {
    const { directory } = await fixture();
    await expect(importRaster({ id: "remote", source: "https://example.com/product.png" })).rejects.toThrow(/local file/);
    const svg = path.join(directory, "unsafe.svg");
    await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
    await expect(importRaster({ id: "svg", source: svg })).rejects.toThrow(/single-frame PNG/);
    const gif = Buffer.from("47494638396101000100800000ff000000000021f90400010000002c000000000100010000020244010021f90400010000002c00000000010001000002024c01003b", "hex");
    const animated = await sharp(gif, { animated: true }).webp().toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    const animation = path.join(directory, "animated.webp"); await fs.writeFile(animation, animated);
    await expect(importRaster({ id: "animation", source: animation })).rejects.toThrow(/single-frame/);
    const jpeg = await sharp({ create: { width: 30, height: 10, channels: 3, background: "#abcabc" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const file = path.join(directory, "oriented.jpg"); await fs.writeFile(file, jpeg);
    const imported = await importRaster({ id: "oriented", source: file });
    expect(imported.asset.sha256).toBe(sha256(jpeg));
    expect([imported.asset.width, imported.asset.height]).toEqual([10, 30]);
  });

  it("out-of-bounds/unsupported fields/missing glyphs fail without changing the project", async () => {
    const { root } = await fixture();
    const before = await tree(root);
    for (const patch of [{ x: 980 }, { blend: "multiply" }, { text: "missing\u{10FFFF}" }]) {
      await expect(editBatch(root, batch(1, [update("text" in patch ? "headline" : "product", patch)]))).rejects.toThrow();
      expect(await tree(root)).toEqual(before);
    }
    await expect(editBatch(root, batch(1, [{ type: "set_canvas", canvas: { width: 8192, height: 8192, background: "#ffffff" } }]))).rejects.toThrow(/pixel limit/);
    await expect(editBatch(root, batch(1, [{ type: "constructor" }]))).rejects.toThrow(/Unsupported operation/);
    await expect(editBatch(root, batch(1, [{ type: "add_object", object: { id: "invalid", kind: "constructor" } }]))).rejects.toThrow(/Unsupported object kind/);
    expect(await tree(root)).toEqual(before);
  });

  it("real Chinese rendering: copy/price change preserves all pixels outside those boxes and logo pixels", async () => {
    const { root, directory } = await fixture();
    const first = await renderProject(root, path.join(directory, "before"));
    await editBatch(root, batch(1, [update("headline", { text: "自在新生\n轻盈日常" }), update("price", { text: "¥139" })]));
    const second = await renderProject(root, path.join(directory, "after"));
    const a = await pixels(path.join(first.output, "image.png")), b = await pixels(path.join(second.output, "image.png"));
    expect(a.info).toEqual(b.info);
    let changes = 0;
    for (let y = 0; y < a.info.height; y++) for (let x = 0; x < a.info.width; x++) {
      const at = (y * a.info.width + x) * 4;
      if (!a.data.subarray(at, at + 4).equals(b.data.subarray(at, at + 4))) {
        changes++;
        const inside = (x >= 70 && x < 550 && y >= 202 && y < 422) || (x >= 75 && x < 515 && y >= 590 && y < 680);
        if (!inside) throw new Error(`Unexpected changed pixel ${x},${y}`);
      }
    }
    expect(changes).toBeGreaterThan(1000);
    expect(second.receipt.qa?.font_glyphs).toBe("PASS");
    expect(second.receipt.visual_quality).toBe("UNVERIFIED");
    expect(await fs.readFile(path.join(second.output, "image.svg"), "utf8")).toMatch(/<path/);
  });

  it("preview is a resize of the same rendered PNG; undo/reopen PNG bytes are identical", async () => {
    const { root, directory } = await fixture();
    const first = await renderProject(root, path.join(directory, "initial"));
    const preview = await renderProject(root, path.join(directory, "preview"), { previewMax: 640 });
    const expected = await sharp(await fs.readFile(path.join(first.output, "image.png"))).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    expect(preview.receipt.outputs?.png.sha256).toBe(sha256(expected));
    await editBatch(root, batch(1, [update("product", { x: 555, y: 227, width: 390, height: 602 }), update("headline", { y: 176 })]));
    await renderProject(root, path.join(directory, "changed"));
    await editBatch(root, batch(2, [{ type: "revert_to", revision: 1 }]));
    const undo = await renderProject(root, path.join(directory, "undo"));
    expect(undo.receipt.outputs?.png.sha256).toBe(first.receipt.outputs?.png.sha256);
    const reopened = await renderProject(root, path.join(directory, "reopen"));
    expect(reopened.receipt.outputs?.png.sha256).toBe(first.receipt.outputs?.png.sha256);
    await expect(renderProject(root, first.output)).rejects.toThrow(/EEXIST/);
    expect(sha256(await fs.readFile(path.join(first.output, "image.png")))).toBe(first.receipt.outputs?.png.sha256);
  });

  it("explicit Chinese newline equals two independently positioned text lines in actual pixels", async () => {
    const { root, directory } = await fixture();
    const first = await renderProject(root, path.join(directory, "multiline"));
    const original = text((await readProject(root)).document, "headline");
    const [line1, line2] = original.text.split("\n");
    const lineHeight = original.font_size * original.line_height;
    await editBatch(root, batch(1, [update("headline", { text: line1, height: lineHeight }),
      { type: "add_object", object: { ...original, id: "headline-line2", text: line2, y: original.y + lineHeight, height: lineHeight } }]));
    const explicit = await renderProject(root, path.join(directory, "two-objects"));
    expect(explicit.receipt.outputs?.png.sha256).toBe(first.receipt.outputs?.png.sha256);
    const measurements = first.receipt.qa?.text_measurements as Record<string, { height: number }>;
    expect(measurements.headline?.height).toBe(lineHeight * 2);
  });

  it("image contain/cover/fill produce their declared geometry in real pixels", async () => {
    const directory = await tempDirectory("image-engine-fit-");
    const red = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const blue = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#0000ff" } }).png().toBuffer();
    const source = path.join(directory, "tile.png");
    await fs.writeFile(source, await sharp({ create: { width: 80, height: 40, channels: 3, background: "#ffffff" } }).composite([{ input: red, left: 0, top: 0 }, { input: blue, left: 40, top: 0 }]).png().toBuffer());
    const root = path.join(directory, "project");
    await createProject(root, { project_id: "fit", title: "Image fit test", canvas: { width: 100, height: 100, background: "#ffffff" }, assets: [{ id: "tile", source }],
      objects: [{ id: "tile", kind: "image", locked: false, visible: true, x: 10, y: 10, width: 80, height: 80, opacity: 1, asset_id: "tile", fit: "contain" }] });
    const rgb = (data: Buffer, x: number, y: number): number[] => [...data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)];
    for (const [index, fit] of ["contain", "cover", "fill"].entries()) {
      if (index) await editBatch(root, batch(index, [update("tile", { fit })]));
      const rendered = await renderProject(root, path.join(directory, fit));
      const { data } = await pixels(path.join(rendered.output, "image.png"));
      expect(rgb(data, 30, 20)).toEqual(fit === "contain" ? [255, 255, 255] : [255, 0, 0]);
      expect(rgb(data, 30, 40)).toEqual([255, 0, 0]);
      expect(rgb(data, 70, 40)).toEqual([0, 0, 255]);
    }
  });

  it("text overflow/narrow glyph/cancel/timeout leave failure receipts, no output images and unchanged source", async () => {
    // General create can load legacy structurally valid but overflowing layouts.
    // Render must still reject them independently of edit-time preflight.
    const { root, directory } = await fixture((input) => { objectById(input as unknown as ImageDocument, "headline").height = 10; });
    const before = await tree(root);
    await expect(renderProject(root, path.join(directory, "overflow"))).rejects.toThrow(/Text overflow/);
    const receipt = await readJson(path.join(directory, "overflow/receipt.json"));
    expect(receipt.status).toBe("failed"); expect(receipt.outputs).toBeUndefined();
    await expect(fs.stat(path.join(directory, "overflow/image.png"))).rejects.toThrow(/ENOENT/);
    expect(await tree(root)).toEqual(before);
    const narrow = await fixture((input) => { objectById(input as unknown as ImageDocument, "headline").width = 10; });
    const narrowBefore = await tree(narrow.root);
    await expect(renderProject(narrow.root, path.join(directory, "narrow"))).rejects.toThrow(/narrower than glyph/);
    expect(await tree(narrow.root)).toEqual(narrowBefore);
    await editBatch(root, batch(1, [update("headline", { height: 220 })]));
    const unchanged = await tree(root);
    const controller = new AbortController(); controller.abort();
    await expect(renderProject(root, path.join(directory, "cancelled"), { signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect((await readJson(path.join(directory, "cancelled/receipt.json"))).status).toBe("cancelled");
    await expect(renderProject(root, path.join(directory, "timeout"), { timeoutMs: 1 })).rejects.toThrow(/timed out/);
    expect((await readJson(path.join(directory, "timeout/receipt.json"))).status).toBe("failed");
    for (const output of ["cancelled", "timeout"]) expect(await fs.readdir(path.join(directory, output))).toEqual(["receipt.json"]);
    expect(await tree(root)).toEqual(unchanged);
  });

  it("historical render and preview bind the selected revision without changing current layout or locks", async () => {
    const { root, directory } = await fixture();
    const original = await readProject(root);
    const initial = await renderProject(root, path.join(directory, "initial"));
    const initialPreview = await renderProject(root, path.join(directory, "initial-preview"), { previewMax: 640 });
    await editBatch(root, batch(1, [update("price", { text: "¥139" }), { type: "set_canvas", canvas: { width: 1200, height: 1200, background: "#ffffff" } }]));
    const current = await readProject(root), before = await tree(root);
    for (const [name, expected, previewMax] of [["render", initial, 0], ["preview", initialPreview, 640]] as const) {
      const result = await renderProject(root, path.join(directory, `history-${name}`), { revision: 1, previewMax });
      expect(result.receipt.revision).toBe(1);
      expect(result.receipt.project_sha256).toBe(original.sha256);
      expect(result.receipt.outputs?.png.sha256).toBe(expected.receipt.outputs?.png.sha256);
      expect(result.receipt.canvas).toEqual(original.document.canvas);
      expect(await tree(root)).toEqual(before);
    }
    const latest = await renderProject(root, path.join(directory, "latest"));
    expect(latest.receipt.revision).toBe(2);
    expect(latest.receipt.project_sha256).toBe(current.sha256);
    expect(latest.receipt.outputs?.png.width).toBe(1200);
    expect(latest.receipt.outputs?.png.sha256).not.toBe(initial.receipt.outputs?.png.sha256);
    await expect(renderProject(root, path.join(directory, "bad-revision"), { revision: 3 })).rejects.toThrow(/requested revision/);
    expect(await tree(root)).toEqual(before);
  });

  it("an interrupted create is reported as incomplete rather than a broken history", async () => {
    const directory = await tempDirectory("image-engine-incomplete-");
    const root = path.join(directory, "project");
    await fs.mkdir(root); for (const folder of ["assets", "fonts", "revisions"]) await fs.mkdir(path.join(root, folder));
    await expect(readProject(root)).rejects.toThrow(/Incomplete project/);
  });

  it("OS alias directories under the filesystem root are accepted; nested symlinks are still refused", async () => {
    const alias = os.tmpdir(); // /var/folders/... on macOS, where /var -> /private/var
    const directory = await fs.mkdtemp(path.join(alias, "image-engine-alias-"));
    try {
      const input = await demoInput(path.join(directory, "source"));
      const root = path.join(directory, "project");
      const created = await createProject(root, input);
      expect((await readProject(root)).sha256).toBe(created.sha256);
      await fs.symlink(root, path.join(directory, "linked"));
      await expect(readProject(path.join(directory, "linked"))).rejects.toThrow(/Symlink paths are unsupported/);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  it("legacy creative-craft documents open read-only and upgrade their schema on the next revision", async () => {
    const { root } = await fixture();
    const file = path.join(root, "revisions/000001.json");
    const legacy = await readJson(file);
    legacy.schema = "creative-craft.local-image.v1";
    await fs.writeFile(file, encode(legacy));
    expect((await readProject(root)).document.schema).toBe("creative-craft.local-image.v1");
    const edited = await editBatch(root, batch(1, [update("price", { text: "¥139" })]));
    expect(edited.document.schema).toBe("newmoney.image-project.v1");
    legacy.schema = "someone-else.v9";
    await fs.writeFile(file, encode(legacy));
    await expect(readProject(root)).rejects.toThrow(/Unsupported image document schema/);
  });

  it("editing past the revision limit fails with an actionable message", async () => {
    const { root } = await fixture();
    const revisions = path.join(root, "revisions");
    let previous: Buffer = await fs.readFile(path.join(revisions, "000001.json")), doc = JSON.parse(previous.toString("utf8")) as ImageDocument;
    for (let revision = 2; revision <= LIMITS.revisions; revision++) {
      doc = { ...doc, revision, parent_sha256: sha256(previous), change: { author: "agent", summary: "Filler", operations: ["update_object"] } };
      previous = encode(doc);
      await fs.writeFile(path.join(revisions, `${String(revision).padStart(6, "0")}.json`), previous);
    }
    await expect(editBatch(root, { base_revision: LIMITS.revisions, author: "agent", summary: "One more", operations: [{ type: "update_object", id: "headline", patch: { y: 90 } }] })).rejects.toThrow(/Revision limit reached/);
  });
});
