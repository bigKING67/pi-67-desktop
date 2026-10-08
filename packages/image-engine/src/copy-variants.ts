import * as fs from "node:fs/promises";
import path from "node:path";
import { record, id, string, number, digest, validateDocument, LIMITS, type JsonRecord } from "./document.js";
import { readProject, editBatch, encode, regularPath, type ProjectState } from "./project.js";
import { readBytes, assertOutsideProject } from "./raster.js";
import { renderProject } from "./render.js";
import { sha256 } from "./content-store.js";

export const COPY_VARIANTS_SCHEMA = "newmoney.image-copy-variants.v1";
export interface VariantSpec { name: string; revision: number; sha256: string }
export interface TextUpdate { id: string; text: string }
export interface VariantResult {
  name: string; source: { project_id: string; revision: number; sha256: string }; project: string; export: string; revision: 2; document_sha256: string; png_sha256: string;
}
export interface VariantManifest { schema: typeof COPY_VARIANTS_SCHEMA; status: "completed"; updates: TextUpdate[]; variants: VariantResult[] }

// Derived projects intentionally start a fresh history; source provenance lives
// in the set manifest rather than pretending to carry source candidate decisions.
export async function copyVariants(rootPath: string, input: unknown, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<{ output: string; manifest: VariantManifest }> {
  record(input, ["output", "variants", "updates"], "copy variants");
  string(input.output, "output", 4096);
  const variants = input.variants, updates = input.updates;
  if (!Array.isArray(variants) || !variants.length || variants.length > 12) throw new Error("Expected 1–12 variants");
  if (!Array.isArray(updates) || !updates.length || updates.length > LIMITS.operations) throw new Error("Expected 1–100 text updates");
  const names = new Set<string>(), ids = new Set<string>();
  for (const variant of variants) {
    record(variant, ["name", "revision", "sha256"], "variant");
    id(variant.name, "variant name"); number(variant.revision, "revision", 1, LIMITS.revisions, true); digest(variant.sha256);
    const key = variant.name.toLowerCase();
    if (names.has(key)) throw new Error("Duplicate variant name"); names.add(key);
  }
  for (const update of updates) {
    record(update, ["id", "text"], "text update"); id(update.id); string(update.text, "text");
    if (ids.has(update.id)) throw new Error("Duplicate text update"); ids.add(update.id);
  }
  const specs = variants as unknown as VariantSpec[], textUpdates = updates as unknown as TextUpdate[];
  const cancelled = (): void => { if (signal?.aborted) throw new Error("Copy variants cancelled"); };
  cancelled();
  const root = await regularPath(rootPath, { directory: true });
  const output = path.resolve(input.output);
  await regularPath(path.dirname(output), { directory: true });
  await assertOutsideProject(root, output);
  const sources: ProjectState[] = [];
  for (const variant of specs) {
    const source = await readProject(root, { revision: variant.revision });
    if (source.sha256 !== variant.sha256) throw new Error(`Stale source binding: ${variant.name}`);
    for (const update of textUpdates) {
      const object = source.document.objects.find((value) => value.id === update.id);
      if (!object || object.kind !== "text" || object.locked) throw new Error(`Expected unlocked text object: ${update.id} in ${variant.name}`);
    }
    sources.push(source);
  }
  cancelled();
  await fs.mkdir(output); // Exclusive ownership; never clean a preexisting target.
  try {
    const manifest: VariantManifest = { schema: COPY_VARIANTS_SCHEMA, status: "completed", updates: textUpdates, variants: [] };
    for (const [index, variant] of specs.entries()) {
      cancelled();
      const source = sources[index] as ProjectState, directory = path.join(output, variant.name), projectRoot = path.join(directory, "project");
      await fs.mkdir(directory); await fs.mkdir(projectRoot);
      for (const folder of ["assets", "fonts", "revisions"]) await fs.mkdir(path.join(projectRoot, folder));
      const bindings = new Map<string, string>([[source.document.font.file, source.document.font.sha256]]);
      for (const asset of source.document.assets) {
        bindings.set(asset.file, asset.sha256); bindings.set(asset.render_file, asset.render_sha256);
      }
      for (const [file, expected] of bindings) {
        const bytes = await readBytes(path.join(root, file), LIMITS.renderBytes);
        if (sha256(bytes) !== expected) throw new Error("Source asset changed during copy");
        await fs.writeFile(path.join(projectRoot, file), bytes, { flag: "wx" });
      }
      const document = structuredClone(source.document);
      document.revision = 1; document.parent_sha256 = null;
      document.change = { author: "system", summary: `Snapshot of source revision ${variant.revision}`, operations: ["create"] };
      validateDocument(document);
      await fs.writeFile(path.join(projectRoot, "revisions/000001.json"), encode(document), { flag: "wx" });
      const batch: JsonRecord = { base_revision: 1, author: "agent", summary: "Apply shared variant copy",
        operations: textUpdates.map((update) => ({ type: "update_object", id: update.id, patch: { text: update.text } })) };
      await editBatch(projectRoot, batch);
      const rendered = await renderProject(projectRoot, path.join(directory, "export"), { signal });
      manifest.variants.push({ name: variant.name, source: { project_id: source.document.project_id, revision: variant.revision, sha256: source.sha256 },
        project: `${variant.name}/project`, export: `${variant.name}/export`, revision: 2,
        document_sha256: rendered.receipt.document_sha256, png_sha256: rendered.receipt.outputs?.png.sha256 ?? "" });
    }
    for (const variant of specs) {
      if ((await readProject(root, { revision: variant.revision })).sha256 !== variant.sha256) throw new Error("Source revision changed during export");
    }
    cancelled();
    await fs.writeFile(path.join(output, "manifest.json"), encode(manifest), { flag: "wx" });
    return { output, manifest };
  } catch (error) {
    await fs.rm(output, { recursive: true, force: true });
    throw error;
  }
}
