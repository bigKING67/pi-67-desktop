import path from "node:path";
import sharp from "sharp";
import { LIMITS, record, id, string, number, color, type SceneObject } from "./document.js";
import { importRaster, type ImportedRaster } from "./raster.js";
import { templateCanvas, prepareTemplate, type PhotoBrief, type TemplateLayout } from "./photo-templates.js";
import type { CreateInput } from "./project.js";

export interface EdgeColor { mean: string; spread: number }
export interface PhotoEdges { top: EdgeColor; bottom: EdgeColor; left: EdgeColor; right: EdgeColor }
export interface StarterLayout {
  header_height: number; photo: { x: number; y: number; width: number; height: number; scale: 1; cropped: false }; photo_edges: PhotoEdges;
}
export type PhotoLayout = StarterLayout | (TemplateLayout & { photo_edges: PhotoEdges });
export interface PreparedPhotoProject { input: CreateInput; imports: ImportedRaster[]; layout: PhotoLayout }

// A whole-photo starter layout. This does not infer a product mask or extend
// the photo background: every imported pixel stays inside the locked object.
export async function preparePhotoProject(value: unknown): Promise<PreparedPhotoProject> {
  record(value, ["project_id", "source", "headline", "brand", "caption", "title", "canvas", "template", "background"], "photo brief");
  if (Object.hasOwn(value, "background")) color(value.background);
  id(value.project_id, "project_id");
  string(value.source, "photo source", 4096);
  if (!path.isAbsolute(value.source)) throw new Error("Photo source must be an absolute local path");
  string(value.headline, "headline");
  for (const key of ["brand", "caption", "title"] as const) {
    if (Object.hasOwn(value, key)) string(value[key], key, key === "title" ? 200 : 2000);
  }
  const brief = value as unknown as PhotoBrief;
  const template = Object.hasOwn(value, "template") ? templateCanvas(value.template) : undefined;
  // Explicit null is malformed, not a request for the default.
  if (Object.hasOwn(value, "canvas")) record(value.canvas, ["width", "height"], "photo canvas");
  const canvas = (brief.canvas ?? template ?? { width: 1280, height: 1600 }) as { width: number; height: number };
  number(canvas.width, "photo canvas.width", 640, 8192, true);
  number(canvas.height, "photo canvas.height", 384, 8192, true);
  if (canvas.width * canvas.height > LIMITS.pixels) throw new Error("Canvas pixel limit exceeded");
  const imported = await importRaster({ id: "photo", source: brief.source });
  const { width, height } = imported.asset;
  const header = 320;
  if (!template && (width > canvas.width || height > canvas.height - header)) {
    throw new Error(`Photo ${width}x${height} does not fit below the ${header}px header; supply canvas.width >= ${Math.max(640, width)} and canvas.height >= ${Math.max(384, height + header)}. No automatic resize or crop.`);
  }
  const rgba = await sharp(imported.rendered).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) throw new Error("create-photo requires an opaque photo; use create for transparent layers");
  }
  // Report the photo's border colors so the caller can choose a canvas that
  // continues the photo background; nothing is inferred or applied automatically.
  const edges = photoEdges(rgba, width, height);
  if (template) { const prepared = prepareTemplate(brief, canvas, imported); return { ...prepared, layout: { ...prepared.layout, photo_edges: edges } }; }
  const photo: SceneObject = { id: "photo", kind: "image", locked: true, visible: true,
    x: Math.floor((canvas.width - width) / 2), y: header + Math.floor((canvas.height - header - height) / 2),
    width, height, opacity: 1, asset_id: "photo", fit: "contain" };
  const left = Math.floor(canvas.width / 16);
  const text = (objectId: string, content: string, y: number, boxHeight: number, font_size: number, textColor: string): SceneObject => ({ id: objectId, kind: "text", locked: false, visible: true,
    x: left, y, width: canvas.width - left * 2, height: boxHeight, opacity: 1, text: content, font_size, color: textColor, align: "left", line_height: 1.25 });
  const objects: SceneObject[] = [photo];
  if (brief.brand !== undefined) objects.push(text("brand", brief.brand, 67, 34, 22, "#56534d"));
  objects.push(text("headline", brief.headline, 123, 112, 70, "#30332e"));
  if (brief.caption !== undefined) objects.push(text("caption", brief.caption, 262, 36, 22, "#8e7850"));
  return {
    input: { project_id: brief.project_id, title: brief.title ?? brief.project_id,
      canvas: { ...canvas, background: brief.background ?? "#ffffff" }, assets: [], objects },
    imports: [imported],
    layout: { header_height: header, photo: { x: photo.x, y: photo.y, width, height, scale: 1, cropped: false }, photo_edges: edges }
  };
}

// Mean color and max channel spread of each one-pixel photo border.
function photoEdges(rgba: Buffer, width: number, height: number): PhotoEdges {
  const hex = (value: number[]): string => `#${value.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const edge = (pixels: number[]): EdgeColor => {
    const sum = [0, 0, 0], min = [255, 255, 255], max = [0, 0, 0];
    for (const at of pixels) for (let c = 0; c < 3; c++) { const v = rgba[at + c] ?? 0; sum[c] = (sum[c] ?? 0) + v; min[c] = Math.min(min[c] ?? 255, v); max[c] = Math.max(max[c] ?? 0, v); }
    return { mean: hex(sum.map((v) => v / pixels.length)), spread: Math.max(...max.map((v, c) => v - (min[c] ?? 0))) };
  };
  const row = (y: number): number[] => Array.from({ length: width }, (_, x) => (y * width + x) * 4);
  const column = (x: number): number[] => Array.from({ length: height }, (_, y) => (y * width + x) * 4);
  return { top: edge(row(0)), bottom: edge(row(height - 1)), left: edge(column(0)), right: edge(column(width - 1)) };
}
