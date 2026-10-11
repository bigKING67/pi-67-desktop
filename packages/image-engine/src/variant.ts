import { sha256 } from "./content-store.js";
import { documentSchema, isLocked, type ImageDocument } from "./document.js";
import { checkTextGlyphs } from "./font.js";
import type { ProjectState } from "./project.js";
import type { ImportedRaster } from "./raster.js";
import { fitText, writeSibling } from "./sibling-project.js";

// P5: one way to write a variant of a revision — a batch row or a project made from a
// template — as a sibling project with new words and pictures in some layers.

export interface VariantInput {
  project_id: string; title: string; summary: string;
  /** Text layer id → its new words. */
  texts: Readonly<Record<string, string>>;
  /** Image layer id → a newly imported picture, laid into the layer's box with its fit. */
  images?: Readonly<Record<string, ImportedRaster>>;
}
export type VariantResult = { status: "created"; shrunk: string[]; sha256: string } | { status: "refused"; reason: string };

/**
 * From a template only its slots change, whatever their lock, and the variant is a plain
 * project with its slots unlocked and every other layer locked; from any other project a
 * locked layer is refused. Text that grows shrinks to 70% before the variant is refused; a
 * character no font has is refused. Nothing is written for a refusal.
 */
export async function writeVariant(source: ProjectState, target: string, input: VariantInput): Promise<VariantResult> {
  const template = source.document.template, slots = new Set(template?.slots ?? []);
  const document: ImageDocument = { ...structuredClone(source.document), project_id: input.project_id, title: input.title, revision: 1, parent_sha256: null,
    change: { author: "system", summary: input.summary, operations: ["create"] } };
  const replaceable = (layer: string, kind: "text" | "image"): string | undefined => {
    const object = document.objects.find((item) => item.id === layer);
    if (object?.kind !== kind) return kind === "text" ? `没有叫「${layer}」的文字图层` : `没有叫「${layer}」的图片图层`;
    if (template && !slots.has(layer)) return `「${layer}」不是这个模板的可替换图层`;
    if (!template && isLocked(document, object)) return `${kind === "text" ? "文字" : "图片"}图层「${layer}」已锁定`;
    return undefined;
  };
  for (const [layer, text] of Object.entries(input.texts)) {
    const refused = replaceable(layer, "text");
    if (refused) return { status: "refused", reason: refused };
    if (!text.trim()) return { status: "refused", reason: `「${layer}」是空的；空格子应保留原文字，不要传入` };
    const object = document.objects.find((item) => item.id === layer);
    if (object?.kind === "text") object.text = text;
  }
  const imports = Object.values(input.images ?? {});
  for (const [layer, imported] of Object.entries(input.images ?? {})) {
    const refused = replaceable(layer, "image");
    if (refused) return { status: "refused", reason: refused };
    const object = document.objects.find((item) => item.id === layer);
    if (object?.kind === "image") object.asset_id = imported.asset.id;
    document.assets.push(imported.asset);
  }
  if (template) {
    delete document.template;
    document.objects = document.objects.map((object) => ({ ...object, locked: !slots.has(object.id) }));
  }
  try { checkTextGlyphs(source.font, document.objects.filter((object) => object.kind === "text"), source.fonts); }
  catch { return { status: "refused", reason: "有字体里没有的字符" }; }
  document.schema = documentSchema(document);
  const fitted = await fitText(source.root, source.font, source.fonts, document);
  if (typeof fitted === "string") return { status: "refused", reason: fitted };
  const bytes = await writeSibling(source.root, target, document, imports);
  return { status: "created", shrunk: fitted, sha256: sha256(bytes) };
}
