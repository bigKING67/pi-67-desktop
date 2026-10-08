import { fail } from "./content-store.js";
import { fontManifest } from "./font.js";

export const SCHEMA = "newmoney.image-project.v1";
// Projects written by the creative-craft source executor open read-only and
// upgrade to the current schema on their next published revision.
export const LEGACY_SCHEMAS: readonly string[] = ["creative-craft.local-image.v1"];
export const LIMITS = Object.freeze({
  pixels: 16_777_216, sourceBytes: 20_000_000, renderBytes: 16_777_216 * 5, objects: 100, assets: 64, operations: 100, revisions: 1000
});

export type JsonRecord = Record<string, unknown>;
export type RasterFormat = "png" | "jpeg" | "webp";
export type ChangeAuthor = "human" | "agent" | "system";

export interface Canvas { width: number; height: number; background: string }
export interface Asset {
  id: string; file: string; sha256: string; format: RasterFormat; width: number; height: number; render_file: string; render_sha256: string;
}
export interface ObjectBase { id: string; locked: boolean; visible: boolean; x: number; y: number; width: number; height: number; opacity: number }
export interface ImageObject extends ObjectBase { kind: "image"; asset_id: string; fit: "contain" | "cover" | "fill" }
export interface TextObject extends ObjectBase {
  kind: "text"; text: string; font_size: number; color: string; align: "left" | "center" | "right"; line_height: number;
}
export interface RectObject extends ObjectBase { kind: "rect"; color: string; radius: number }
export type SceneObject = ImageObject | TextObject | RectObject;
export interface FontBinding { profile: string; family: string; file: string; sha256: string; weight: number }
export interface AcceptedCandidate { id: string; sha256: string }
export interface Change { author: ChangeAuthor; summary: string; operations: string[]; candidate?: AcceptedCandidate }
export interface ImageDocument {
  schema: string; project_id: string; title: string; revision: number; parent_sha256: string | null;
  canvas: Canvas; assets: Asset[]; font: FontBinding; objects: SceneObject[]; change: Change;
}

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function record(value: unknown, keys: readonly string[], label: string): asserts value is JsonRecord {
  if (!isRecord(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}: unsupported field ${key}`);
}
export function id(value: unknown, label = "id"): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value)) fail(`Invalid ${label}`);
}
export function string(value: unknown, label: string, max = 2000): asserts value is string {
  if (typeof value !== "string" || !value.length || value.length > max) fail(`Invalid ${label}`);
}
export function number(value: unknown, label: string, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`Invalid ${label}`);
}
function boolean(value: unknown, label: string): asserts value is boolean { if (typeof value !== "boolean") fail(`Invalid ${label}`); }
export function color(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) fail("Color must be #RRGGBB");
}
export function digest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("Invalid SHA-256");
}
const oneOf = <T extends string>(value: unknown, values: readonly T[], message: string): T => {
  if (typeof value !== "string" || !values.includes(value as T)) fail(message);
  return value as T;
};

export function validateCanvas(value: unknown): Canvas {
  record(value, ["width", "height", "background"], "canvas");
  number(value.width, "canvas.width", 64, 8192, true);
  number(value.height, "canvas.height", 64, 8192, true);
  if (value.width * value.height > LIMITS.pixels) fail("Canvas pixel limit exceeded");
  color(value.background);
  return { width: value.width, height: value.height, background: value.background };
}

export function validateAsset(value: unknown): Asset {
  record(value, ["id", "file", "sha256", "format", "width", "height", "render_file", "render_sha256"], "asset");
  id(value.id, "asset.id");
  digest(value.sha256); digest(value.render_sha256);
  const format = oneOf(value.format, ["png", "jpeg", "webp"] as const, "Unsupported raster format");
  if (value.file !== `assets/${value.sha256}.${format}` || value.render_file !== `assets/${value.render_sha256}.png`) fail("Invalid content-addressed asset path");
  number(value.width, "asset.width", 1, 8192, true); number(value.height, "asset.height", 1, 8192, true);
  if (value.width * value.height > LIMITS.pixels) fail("Asset pixel limit exceeded");
  return value as unknown as Asset;
}

// C0/C1 controls (except newline), zero-width and bidi/format characters: no
// untrusted markup, external font loading, controls or shaping fallback.
const CONTROL_RANGES: readonly [number, number][] = [[0x0000, 0x0009], [0x000b, 0x001f], [0x007f, 0x009f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f]];
function hasControlCharacter(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (CONTROL_RANGES.some(([start, end]) => cp >= start && cp <= end)) return true;
  }
  return false;
}

const COMMON = ["id", "kind", "locked", "visible", "x", "y", "width", "height", "opacity"] as const;
const EXTRA = {
  image: ["asset_id", "fit"], text: ["text", "font_size", "color", "align", "line_height"], rect: ["color", "radius"]
} as const satisfies Record<SceneObject["kind"], readonly string[]>;

function validateObject(value: unknown, canvas: Canvas, assets: ReadonlySet<string>): SceneObject {
  if (!isRecord(value)) fail("object must be an object");
  const kind = value.kind;
  if (kind !== "image" && kind !== "text" && kind !== "rect") fail("Unsupported object kind");
  record(value, [...COMMON, ...EXTRA[kind]], "object"); id(value.id, "object.id");
  boolean(value.locked, "locked"); boolean(value.visible, "visible");
  number(value.x, "object.x", 0, canvas.width); number(value.y, "object.y", 0, canvas.height);
  number(value.width, "object.width", 1, canvas.width); number(value.height, "object.height", 1, canvas.height);
  if (value.x + value.width > canvas.width || value.y + value.height > canvas.height) fail(`Object outside canvas: ${value.id}`);
  number(value.opacity, "opacity", 0, 1);
  if (kind === "image") {
    if (typeof value.asset_id !== "string" || !assets.has(value.asset_id)) fail(`Missing asset for ${value.id}`);
    oneOf(value.fit, ["contain", "cover", "fill"] as const, "Invalid image fit");
  } else if (kind === "text") {
    string(value.text, "text");
    if (hasControlCharacter(value.text)) fail("Unsupported text control character");
    number(value.font_size, "font_size", 8, 500); number(value.line_height, "line_height", 1, 2);
    color(value.color); oneOf(value.align, ["left", "center", "right"] as const, "Invalid text alignment");
  } else { color(value.color); number(value.radius, "radius", 0, Math.min(value.width, value.height) / 2); }
  return value as unknown as SceneObject;
}

export function validateDocument(value: unknown): ImageDocument {
  record(value, ["schema", "project_id", "title", "revision", "parent_sha256", "canvas", "assets", "font", "objects", "change"], "document");
  if (value.schema !== SCHEMA && !LEGACY_SCHEMAS.includes(value.schema as string)) fail("Unsupported image document schema");
  id(value.project_id, "project_id"); string(value.title, "title", 200);
  number(value.revision, "revision", 1, LIMITS.revisions, true);
  if (value.revision === 1) { if (value.parent_sha256 !== null) fail("Initial revision must have null parent"); }
  else digest(value.parent_sha256);
  const canvas = validateCanvas(value.canvas);
  record(value.font, ["profile", "family", "file", "sha256", "weight"], "font");
  const font = value.font;
  for (const key of ["profile", "family", "sha256", "weight"] as const) if (font[key] !== fontManifest[key]) fail(`Unsupported font ${key}`);
  if (font.file !== `fonts/${fontManifest.sha256}.otf`) fail("Invalid bound font path");
  if (!Array.isArray(value.assets) || value.assets.length > LIMITS.assets) fail("Invalid assets list");
  const assetIds = new Set<string>();
  const assets = value.assets.map((asset) => {
    const valid = validateAsset(asset);
    if (assetIds.has(valid.id)) fail("Duplicate asset id"); assetIds.add(valid.id);
    return valid;
  });
  if (!Array.isArray(value.objects) || !value.objects.length || value.objects.length > LIMITS.objects) fail("Invalid objects list");
  const ids = new Set<string>();
  const objects = value.objects.map((object) => {
    const valid = validateObject(object, canvas, assetIds);
    if (ids.has(valid.id)) fail("Duplicate object id"); ids.add(valid.id);
    return valid;
  });
  record(value.change, ["author", "summary", "operations", "candidate"], "change");
  const change = value.change;
  oneOf(change.author, ["human", "agent", "system"] as const, "Invalid change author");
  string(change.summary, "change.summary", 500);
  const operations = change.operations;
  if (!Array.isArray(operations) || !operations.length || operations.length > LIMITS.operations || operations.some((op) => typeof op !== "string")) fail("Invalid change operations");
  if (change.candidate !== undefined) {
    record(change.candidate, ["id", "sha256"], "accepted candidate"); id(change.candidate.id, "candidate id"); digest(change.candidate.sha256);
    if (operations.length !== 1 || operations[0] !== "accept_candidate") fail("Candidate acceptance must be isolated");
  } else if (operations.includes("accept_candidate")) fail("Candidate acceptance needs a bound candidate");
  return { ...(value as unknown as ImageDocument), canvas, assets, objects };
}

export const textObjects = (objects: readonly SceneObject[]): TextObject[] => objects.filter((object): object is TextObject => object.kind === "text");
