import * as fs from "node:fs/promises";
import path from "node:path";
import { errorCode, sha256, writeOnce } from "./content-store.js";
import { digest, id, LIMITS, number, record, textObjects, validateCanvas, validateDocument, type Canvas, type ImageDocument, type SceneObject } from "./document.js";
import { encode, readProject } from "./project.js";
import { regularPath } from "./raster.js";
import { compose } from "./render-compose.js";
import { IMAGE_SIZE_PRESETS, imageSizePresetFits, imageSizePresetLabel, imageSizePresetSize, type ImageSizePreset } from "@pi67/domain";
import { copyProjectFiles } from "./project-copy.js";

// Multi-size presets (product model §7 F, decided 2026-10-10): each size is a
// derived project beside the source, with its own history, re-laid out from one
// source revision — never a scaled copy of the finished image.

export { IMAGE_SIZE_PRESETS as DERIVE_PRESETS } from "@pi67/domain";
export type DerivePreset = ImageSizePreset;

/** Objects at least this share of the canvas width are bands: they span the new width. */
const BAND_SHARE = 0.9;
/** Text may shrink to this share of its proportional size before a preset is refused. */
const MIN_TEXT_SHARE = 0.7;
const TEXT_STEP = 0.05;

/** The preset's canvas: the source's short edge kept, the other edge from the ratio. */
export function presetCanvas(source: Canvas, preset: DerivePreset): Canvas {
  return validateCanvas({ ...imageSizePresetSize(source, preset), background: source.background });
}

/**
 * Re-lays the objects out on `canvas`. Bands (images or shapes spanning the width)
 * stretch across the new width and scale vertically with the canvas; images crop
 * with `cover`, except when the canvas turns from portrait to landscape or back,
 * where `cover` would blow the subject up and cut it, so they fit whole with
 * `contain` (decided 2026-10-10). Everything else scales by the smaller axis
 * factor around its proportionally moved centre, inside the canvas.
 */
export function relayoutObjects(objects: readonly SceneObject[], from: Canvas, canvas: Canvas): SceneObject[] {
  const sx = canvas.width / from.width, sy = canvas.height / from.height, s = Math.min(sx, sy);
  const turns = Math.sign(from.width - from.height) * Math.sign(canvas.width - canvas.height) < 0;
  return objects.map((object) => {
    // A masked object scales as one piece: stretching a band would slide its mask off the pixels it shapes.
    if (object.kind !== "text" && !object.mask && object.width >= from.width * BAND_SHARE) {
      const x = Math.round(object.x * sx), y = Math.round(object.y * sy);
      const width = Math.min(canvas.width - x, Math.max(1, Math.round(object.width * sx))), height = Math.min(canvas.height - y, Math.max(1, Math.round(object.height * sy)));
      if (object.kind === "image") return { ...object, x, y, width, height, fit: turns ? "contain" : "cover" };
      return object.kind === "rect" ? { ...object, x, y, width, height, radius: Math.min(Math.round(object.radius * s), Math.floor(Math.min(width, height) / 2)) } : { ...object, x, y, width, height };
    }
    const width = Math.min(canvas.width, Math.max(1, Math.round(object.width * s))), height = Math.min(canvas.height, Math.max(1, Math.round(object.height * s)));
    const x = clamp(Math.round((object.x + object.width / 2) * sx - width / 2), canvas.width - width);
    const y = clamp(Math.round((object.y + object.height / 2) * sy - height / 2), canvas.height - height);
    if (object.kind === "text") return { ...object, x, y, width, height, font_size: Math.min(500, Math.max(8, Math.round(object.font_size * s))) };
    if (object.kind === "rect") return { ...object, x, y, width, height, radius: Math.min(Math.round(object.radius * s), Math.floor(Math.min(width, height) / 2)) };
    return { ...object, x, y, width, height };
  });
}

const clamp = (value: number, max: number): number => Math.min(Math.max(0, max), Math.max(0, value));

interface DeriveInput { revision: number; sha256: string; preset: DerivePreset; project_id: string; title: string }
export type DeriveResult =
  | { status: "derived"; preset: DerivePreset; project_id: string; title: string; canvas: Canvas; shrunk: string[]; sha256: string }
  | { status: "refused"; preset: DerivePreset; reason: string };

/**
 * Writes a new project at `target` holding one revision: the source revision
 * re-laid out for the preset. Text that overflows shrinks in 5% steps to 70% of
 * its proportional size; past that the preset is refused naming the text, and
 * nothing is written. The source project is only read.
 */
export async function deriveProject(sourceRoot: string, target: string, input: unknown): Promise<DeriveResult> {
  record(input, ["revision", "sha256", "preset", "project_id", "title"], "derive input");
  number(input.revision, "revision", 1, LIMITS.revisions, true); digest(input.sha256); id(input.project_id, "derived project id");
  if (!isDerivePreset(input.preset)) throw new Error("Unknown size preset");
  if (typeof input.title !== "string" || !input.title || input.title.length > 200) throw new Error("Invalid derived title");
  const { revision, preset, project_id: projectId, title } = input as unknown as DeriveInput;
  const root = await regularPath(sourceRoot, { directory: true });
  const source = await readProject(root, { revision });
  if (source.sha256 !== input.sha256) throw new Error("Stale source binding: the source revision changed");
  if (!imageSizePresetFits(imageSizePresetSize(source.document.canvas, preset))) {
    const { width, height } = imageSizePresetSize(source.document.canvas, preset);
    return { status: "refused", preset, reason: `${width}×${height} 超出画布上限（单边 8192、总计 1677 万像素）` };
  }
  const canvas = presetCanvas(source.document.canvas, preset);
  const { font, fonts } = source;

  const laid = relayoutObjects(source.document.objects, source.document.canvas, canvas);
  const proportional = new Map(textObjects(laid).map((object) => [object.id, object.font_size]));
  const document: ImageDocument = { ...structuredClone(source.document), project_id: projectId, title, revision: 1, parent_sha256: null, canvas, objects: laid,
    change: { author: "system", summary: `Derived from ${source.document.project_id} revision ${revision} for ${imageSizePresetLabel(preset)}`, operations: ["create"] } };
  const shrunk = new Set<string>();
  for (;;) {
    try {
      await compose({ root, font, fonts, layoutOnly: true, document: { ...document, assets: [], objects: textObjects(document.objects).filter((object) => object.visible) } });
      break;
    } catch (error) {
      const overflow = /^Text (?:overflow|box narrower than glyph): (.+)$/u.exec(error instanceof Error ? error.message : "");
      const object = overflow ? textObjects(document.objects).find((item) => item.id === overflow[1]) : undefined;
      if (!object) throw error;
      const floor = Math.max(8, Math.ceil((proportional.get(object.id) ?? object.font_size) * MIN_TEXT_SHARE));
      const next = Math.max(floor, Math.floor(object.font_size * (1 - TEXT_STEP)));
      if (next >= object.font_size) return { status: "refused", preset, reason: `文字「${object.text.slice(0, 24)}」在 ${canvas.width}×${canvas.height} 里放不下` };
      document.objects = document.objects.map((item) => item.id === object.id ? { ...object, font_size: next } : item);
      shrunk.add(object.id);
    }
  }
  validateDocument(document);

  try { await fs.mkdir(target); }
  catch (error) { if (errorCode(error) === "EEXIST") throw new Error("Derived project already exists"); throw error; }
  const bytes = encode(document);
  try {
    await copyProjectFiles(root, target, document);
    await writeOnce(path.join(target, "revisions/000001.json"), { bytes }, { expected: sha256(bytes) });
  } catch (error) {
    // Only this call created the directory; nothing else lives there yet.
    await fs.rm(target, { recursive: true, force: true });
    throw error;
  }
  return { status: "derived", preset, project_id: projectId, title, canvas, shrunk: [...shrunk], sha256: sha256(bytes) };
}

export const isDerivePreset = (value: unknown): value is DerivePreset => typeof value === "string" && (IMAGE_SIZE_PRESETS as readonly string[]).includes(value);
