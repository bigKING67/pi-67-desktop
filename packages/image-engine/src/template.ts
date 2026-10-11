import { IMAGE_TEMPLATE_SLOT_LIMIT } from "@pi67/domain";
import { sha256 } from "./content-store.js";
import { documentSchema, id, isRecord, record, string, validateDocument, type ImageDocument } from "./document.js";
import type { ProjectState } from "./project.js";
import { importRaster, type ImportedRaster } from "./raster.js";
import { writeSibling } from "./sibling-project.js";
import { writeVariant, type VariantResult } from "./variant.js";

// P5 checkpoint 2: a template is a copied project with marked replaceable layers (slots); a
// project made from it changes only its slots and keeps every other layer locked.

export const templateSummary = (projectId: string, revision: number): string => `Template from ${projectId} revision ${revision}`;
export const fromTemplateSummary = (templateId: string, revision: number): string => `From template ${templateId} revision ${revision}`;

/** Copies the revision as a template beside it, its slots preset to every text and image layer (at most 20). */
export async function createTemplate(source: ProjectState, target: string, input: { project_id: string; title: string }): Promise<{ sha256: string; slots: string[] }> {
  id(input.project_id, "template id"); string(input.title, "title", 200);
  const slots = source.document.objects.filter((object) => object.kind === "text" || object.kind === "image").map((object) => object.id).slice(0, IMAGE_TEMPLATE_SLOT_LIMIT);
  const document: ImageDocument = { ...structuredClone(source.document), project_id: input.project_id, title: input.title, revision: 1, parent_sha256: null, template: { slots },
    change: { author: "system", summary: templateSummary(source.document.project_id, source.document.revision), operations: ["create"] } };
  document.schema = documentSchema(document);
  validateDocument(document);
  return { sha256: sha256(await writeSibling(source.root, target, document)), slots };
}

/**
 * A new plain project from a template: the given slot words and, per image slot, a picture
 * imported from a local file; the slots unlocked, every other layer locked.
 */
export async function instantiateTemplate(source: ProjectState, target: string, input: unknown): Promise<VariantResult> {
  record(input, ["project_id", "title", "texts", "images"], "template input");
  id(input.project_id, "project id"); string(input.title, "title", 200);
  if (!source.document.template) throw new Error("Not a template");
  const texts = isRecord(input.texts) ? input.texts : {}, images = isRecord(input.images) ? input.images : {};
  for (const [layer, text] of Object.entries(texts)) { id(layer, "text layer"); string(text, "slot text"); }
  const taken = new Set(source.document.assets.map((asset) => asset.id)), imported: Record<string, ImportedRaster> = {};
  for (const [layer, file] of Object.entries(images)) {
    id(layer, "image layer"); string(file, "image source", 4096);
    let assetId = `${layer.slice(0, 50)}-image`;
    for (let index = 2; taken.has(assetId); index++) assetId = `${layer.slice(0, 50)}-image-${index}`;
    taken.add(assetId);
    imported[layer] = await importRaster({ id: assetId, source: file });
  }
  return writeVariant(source, target, { project_id: input.project_id, title: input.title, texts: texts as Record<string, string>, images: imported,
    summary: fromTemplateSummary(source.document.project_id, source.document.revision) });
}
