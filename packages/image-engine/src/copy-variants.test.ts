import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createPhotoProject, readProject, editBatch } from "./project.js";
import { copyVariants } from "./copy-variants.js";
import { renderProject } from "./render.js";
import { sha256 } from "./content-store.js";
import type { ImageObject, JsonRecord } from "./document.js";
import { objectById, tempDirectory, tree } from "./test-support/harness.js";

interface VariantInput { output: string; variants: { name: string; revision: number; sha256: string }[]; updates: { id: string; text: string }[] }

async function fixture(): Promise<{ directory: string; root: string; input: VariantInput }> {
  const directory = await tempDirectory("image-engine-文案-");
  const source = path.join(directory, "source.png"), root = path.join(directory, "project");
  await sharp({ create: { width: 96, height: 64, channels: 3, background: "#b98645" } }).png().toFile(source);
  const a = await createPhotoProject(root, { project_id: "variants", source, headline: "原版", brand: "品牌", caption: "商品", canvas: { width: 640, height: 800 } });
  const b = await editBatch(root, { base_revision: 1, author: "human", summary: "Taller layout", operations: [{ type: "set_canvas", canvas: { width: 640, height: 960, background: "#ffffff" } }] });
  return { directory, root, input: { output: path.join(directory, "output"), variants: [{ name: "square", revision: 1, sha256: a.sha256 }, { name: "tall", revision: 2, sha256: b.sha256 }], updates: [{ id: "headline", text: "新的标题" }] } };
}

describe("copy variants", { timeout: 180_000 }, () => {
  it("shares copy across editable layouts and leaves source, assets and geometry intact", async () => {
    const { root, input } = await fixture(), before = await tree(root);
    const result = await copyVariants(root, input);
    expect(result.manifest.variants).toHaveLength(2);
    for (const variant of result.manifest.variants) {
      const original = await readProject(root, { revision: variant.source.revision });
      const project = await readProject(path.join(input.output, variant.project));
      expect(project.document.revision).toBe(2);
      expect(project.document.canvas).toEqual(original.document.canvas);
      expect(project.document.assets).toEqual(original.document.assets);
      for (const object of project.document.objects) {
        const previous = objectById(original.document, object.id);
        expect(object).toEqual(object.id === "headline" ? { ...previous, text: "新的标题" } : previous);
      }
      const png = await fs.readFile(path.join(input.output, variant.export, "image.png"));
      expect(sha256(png)).toBe(variant.png_sha256);
      const photo = objectById(project.document, "photo") as ImageObject;
      const asset = project.document.assets.find((v) => v.id === photo.asset_id);
      expect(await sharp(png).extract({ left: photo.x, top: photo.y, width: photo.width, height: photo.height }).ensureAlpha().raw().toBuffer())
        .toEqual(await sharp(path.join(root, asset?.render_file ?? "")).ensureAlpha().raw().toBuffer());
    }
    expect(await tree(root)).toEqual(before);
  });

  it("later-layout text overflow rolls back earlier exports and leaves original untouched", async () => {
    const { root, input } = await fixture();
    const narrow = await editBatch(root, { base_revision: 2, author: "human", summary: "Narrow title", operations: [{ type: "update_object", id: "headline", patch: { width: 150 } }] });
    input.variants[1] = { name: "narrow", revision: 3, sha256: narrow.sha256 };
    const before = await tree(root);
    await expect(copyVariants(root, input)).rejects.toThrow(/text|fit|overflow/i);
    await expect(fs.stat(input.output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await tree(root)).toEqual(before);
  });

  it("bindings, identities, text-only scope, destination ownership and cancellation fail closed", async () => {
    const { root, input } = await fixture(), before = await tree(root);
    const cases: ((value: VariantInput & JsonRecord) => void)[] = [
      (value) => { (value.variants[0] as { sha256: string }).sha256 = "0".repeat(64); },
      (value) => { (value.variants[1] as { name: string }).name = "SQUARE"; },
      (value) => { (value.variants[0] as { name: string }).name = "../escape"; },
      (value) => { (value.updates[0] as { id: string }).id = "missing"; },
      (value) => { (value.updates[0] as { id: string }).id = "photo"; },
      (value) => { (value.updates[0] as JsonRecord).width = 20; },
      (value) => { value.updates.push(value.updates[0] as { id: string; text: string }); },
      (value) => { value.output = path.join(root, "nested"); }
    ];
    for (const change of cases) {
      const value = structuredClone(input) as VariantInput & JsonRecord; change(value);
      await expect(copyVariants(root, value)).rejects.toThrow();
      await expect(fs.stat(input.output)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(copyVariants(root, input, { signal: AbortSignal.abort() })).rejects.toThrow(/cancelled/);
    await fs.mkdir(input.output); await fs.writeFile(path.join(input.output, "keep"), "user data");
    await expect(copyVariants(root, input)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(path.join(input.output, "keep"), "utf8")).toBe("user data");
    expect(await tree(root)).toEqual(before);
  });

  it("locked text stays locked and mid-run cancellation removes only owned outputs", async () => {
    const { root, input } = await fixture();
    const locked = await editBatch(root, { base_revision: 2, author: "human", summary: "Lock title", operations: [{ type: "update_object", id: "headline", patch: { locked: true } }] });
    const lockInput = structuredClone(input); lockInput.variants[1] = { name: "locked", revision: 3, sha256: locked.sha256 };
    await expect(copyVariants(root, lockInput)).rejects.toThrow(/unlocked text/);
    await expect(fs.stat(input.output)).rejects.toMatchObject({ code: "ENOENT" });
    const controller = new AbortController();
    const timer = setInterval(() => { void fs.stat(path.join(input.output, "square/project")).then(() => controller.abort(), () => undefined); }, 5);
    try { await expect(copyVariants(root, input, { signal: controller.signal })).rejects.toThrow(/cancel/i); }
    finally { clearInterval(timer); }
    await expect(fs.stat(input.output)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readProject(root)).sha256).toBe(locked.sha256);
  });

  it("outputs inside the source project are refused, including case-variant spellings", async () => {
    const { directory, root, input } = await fixture(), before = await tree(root);
    await expect(renderProject(root, path.join(root, "revisions", "000099.json"))).rejects.toThrow(/outside the project/);
    await expect(copyVariants(root, { ...input, output: path.join(root, "variants") })).rejects.toThrow(/outside the project/);
    const alias = path.join(directory, "PROJECT");
    if (await fs.stat(alias).then(() => true, () => false)) await expect(copyVariants(root, { ...input, output: path.join(alias, "variants") })).rejects.toThrow(/outside the project/);
    expect(await tree(root)).toEqual(before); await readProject(root);
  });

  it("a large photo whose normalized PNG exceeds the source byte limit still produces variants", async () => {
    const { directory } = await fixture();
    const source = path.join(directory, "large.jpg"), root = path.join(directory, "large-project");
    await sharp({ create: { width: 3000, height: 3000, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } }).jpeg({ quality: 90 }).toFile(source);
    const created = await createPhotoProject(root, { project_id: "large", source, headline: "大图", canvas: { width: 3000, height: 3400 } });
    const project = await readProject(root);
    expect((await fs.stat(path.join(root, project.document.assets[0]?.render_file ?? ""))).size).toBeGreaterThan(20_000_000);
    const result = await copyVariants(root, { output: path.join(directory, "large-output"), variants: [{ name: "only", revision: 1, sha256: created.sha256 }], updates: [{ id: "headline", text: "新的大图" }] });
    expect(result.manifest.variants).toHaveLength(1);
  });
});
