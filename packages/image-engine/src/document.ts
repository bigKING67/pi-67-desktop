import { IMAGE_USER_FONT_LIMIT } from "@pi67/domain";
import { fail } from "./content-store.js";
import { fontManifest } from "./font.js";

export const SCHEMA = "newmoney.image-project.v1";
/**
 * Documents that bind user fonts (P3, 2026-10-10). A document is written as v2
 * only while it uses them, so projects without user fonts stay readable by
 * earlier releases after a rollback.
 */
export const SCHEMA_V2 = "newmoney.image-project.v2";
/**
 * Documents that use any P4 engine extension (rotation and flip so far). Like v2,
 * a document is written as v3 only while it uses one; v3 may also bind user fonts.
 */
export const SCHEMA_V3 = "newmoney.image-project.v3";
export const USER_FONT_LIMIT = IMAGE_USER_FONT_LIMIT;
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
export interface ObjectBase {
  id: string; locked: boolean; visible: boolean; x: number; y: number; width: number; height: number; opacity: number;
  /** Degrees clockwise about the box centre, −180…180; absent means none. The unrotated box stays on the canvas. */
  rotation?: number;
  /** Mirrored across the box's vertical (`flip_x`) or horizontal (`flip_y`) centre line; absent means not. */
  flip_x?: true; flip_y?: true;
}
/** Optional fields every object kind may carry; a patch writes `null` (or 0 / false) to drop one. */
const OPTIONAL_COMMON = ["rotation", "flip_x", "flip_y"] as const;
/**
 * Every optional field each kind may carry, and which of them need the v3 schema.
 * One table drives validation, patching and the schema version, so a later P4 field
 * is declared once here.
 */
export const OPTIONAL_FIELDS: Readonly<Record<SceneObject["kind"], readonly string[]>> = {
  image: [...OPTIONAL_COMMON], text: [...OPTIONAL_COMMON, "font_id"], rect: [...OPTIONAL_COMMON, "gradient"], ellipse: [...OPTIONAL_COMMON, "gradient"]
};
const V3_FIELDS: ReadonlySet<string> = new Set([...OPTIONAL_COMMON, "gradient"]);
/** Kinds that exist only from v3. */
const V3_KINDS: ReadonlySet<SceneObject["kind"]> = new Set(["ellipse"]);
export interface ImageObject extends ObjectBase { kind: "image"; asset_id: string; fit: "contain" | "cover" | "fill" }
export interface TextObject extends ObjectBase {
  kind: "text"; text: string; font_size: number; color: string; align: "left" | "center" | "right"; line_height: number;
  /** A user font from `fonts`; absent means the pinned font. Missing glyphs fall back to the pinned font. */
  font_id?: string;
}
/** A linear (with `angle`, CSS degrees) or radial fill of 2–5 stops in order; replaces `color` when present. */
export type Gradient =
  | { type: "linear"; angle?: number; stops: { offset: number; color: string }[] }
  | { type: "radial"; stops: { offset: number; color: string }[] };
export interface RectObject extends ObjectBase { kind: "rect"; color: string; radius: number; gradient?: Gradient }
/** An ellipse filling its box (P4); a line is a thin rotated rect. */
export interface EllipseObject extends ObjectBase { kind: "ellipse"; color: string; gradient?: Gradient }
export type SceneObject = ImageObject | TextObject | RectObject | EllipseObject;
export interface FontBinding { profile: string; family: string; file: string; sha256: string; weight: number }
/** A font file the person added to the project; bound by digest like an asset. */
export interface UserFont { id: string; family: string; file: string; sha256: string; bytes: number; format: "ttf" | "otf" }
export interface AcceptedCandidate { id: string; sha256: string }
export interface Change { author: ChangeAuthor; summary: string; operations: string[]; candidate?: AcceptedCandidate }
export interface ImageDocument {
  schema: string; project_id: string; title: string; revision: number; parent_sha256: string | null;
  canvas: Canvas; assets: Asset[]; font: FontBinding; fonts?: UserFont[]; objects: SceneObject[]; change: Change;
}

/** v3 while any engine extension is used, else v2 while a user font is bound or used, else v1. */
export function documentSchema(document: Pick<ImageDocument, "fonts" | "objects">): string {
  // Called before validation too, so an unknown kind falls through to validation's refusal.
  if (document.objects.some((object) => V3_KINDS.has(object.kind) || (Object.hasOwn(OPTIONAL_FIELDS, object.kind) ? OPTIONAL_FIELDS[object.kind] : []).some((key) => V3_FIELDS.has(key) && (object as unknown as JsonRecord)[key] !== undefined))) return SCHEMA_V3;
  return document.fonts?.length || document.objects.some((object) => object.kind === "text" && object.font_id !== undefined) ? SCHEMA_V2 : SCHEMA;
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

const COMMON = ["id", "kind", "locked", "visible", "x", "y", "width", "height", "opacity", ...OPTIONAL_COMMON] as const;
const EXTRA = {
  image: ["asset_id", "fit"], text: ["text", "font_size", "color", "align", "line_height", "font_id"], rect: ["color", "radius", "gradient"], ellipse: ["color", "gradient"]
} as const satisfies Record<SceneObject["kind"], readonly string[]>;

function validateObject(value: unknown, canvas: Canvas, assets: ReadonlySet<string>, fonts: ReadonlySet<string>): SceneObject {
  if (!isRecord(value)) fail("object must be an object");
  const kind = value.kind;
  if (kind !== "image" && kind !== "text" && kind !== "rect" && kind !== "ellipse") fail("Unsupported object kind");
  record(value, [...COMMON, ...EXTRA[kind]], "object"); id(value.id, "object.id");
  boolean(value.locked, "locked"); boolean(value.visible, "visible");
  number(value.x, "object.x", 0, canvas.width); number(value.y, "object.y", 0, canvas.height);
  number(value.width, "object.width", 1, canvas.width); number(value.height, "object.height", 1, canvas.height);
  if (value.x + value.width > canvas.width || value.y + value.height > canvas.height) fail(`Object outside canvas: ${value.id}`);
  number(value.opacity, "opacity", 0, 1);
  if (value.rotation !== undefined) { number(value.rotation, "rotation", -180, 180); if (value.rotation === 0) fail("Write no rotation instead of 0"); }
  for (const key of ["flip_x", "flip_y"] as const) if (value[key] !== undefined && value[key] !== true) fail(`Invalid ${key}`);
  if (kind === "image") {
    if (typeof value.asset_id !== "string" || !assets.has(value.asset_id)) fail(`Missing asset for ${value.id}`);
    oneOf(value.fit, ["contain", "cover", "fill"] as const, "Invalid image fit");
  } else if (kind === "text") {
    string(value.text, "text");
    if (hasControlCharacter(value.text)) fail("Unsupported text control character");
    number(value.font_size, "font_size", 8, 500); number(value.line_height, "line_height", 1, 2);
    color(value.color); oneOf(value.align, ["left", "center", "right"] as const, "Invalid text alignment");
    if (value.font_id !== undefined && (typeof value.font_id !== "string" || !fonts.has(value.font_id))) fail(`Missing font for ${value.id}`);
  } else {
    color(value.color);
    if (kind === "rect") number(value.radius, "radius", 0, Math.min(value.width, value.height) / 2);
    if (value.gradient !== undefined) validateGradient(value.gradient);
  }
  return value as unknown as SceneObject;
}

export function validateDocument(value: unknown): ImageDocument {
  record(value, ["schema", "project_id", "title", "revision", "parent_sha256", "canvas", "assets", "font", "fonts", "objects", "change"], "document");
  if (value.schema !== SCHEMA && value.schema !== SCHEMA_V2 && value.schema !== SCHEMA_V3 && !LEGACY_SCHEMAS.includes(value.schema as string)) fail("Unsupported image document schema");
  if (value.schema !== SCHEMA_V2 && value.schema !== SCHEMA_V3 && value.fonts !== undefined) fail("User fonts need the v2 document schema");
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
  const fonts = value.fonts === undefined ? undefined : validateUserFonts(value.fonts);
  const fontIds = new Set(fonts?.map((item) => item.id));
  if (!Array.isArray(value.objects) || !value.objects.length || value.objects.length > LIMITS.objects) fail("Invalid objects list");
  const ids = new Set<string>();
  const objects = value.objects.map((object) => {
    const valid = validateObject(object, canvas, assetIds, fontIds);
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
  const document = { ...(value as unknown as ImageDocument), canvas, assets, objects, ...(fonts ? { fonts } : {}) };
  // Each schema is written only for what it needs, so a release that predates a feature still opens the rest.
  const needed = documentSchema(document);
  if (value.schema === SCHEMA_V2 && needed !== SCHEMA_V2) fail("A v2 document must bind or use a user font and nothing newer");
  if (value.schema === SCHEMA_V3 && needed !== SCHEMA_V3) fail("A v3 document must use an engine extension");
  if (needed === SCHEMA_V3 && value.schema !== SCHEMA_V3) fail("Rotation, flips, ellipses and gradients need the v3 document schema");
  return document;
}

function validateGradient(value: unknown): Gradient {
  record(value, ["type", "angle", "stops"], "gradient");
  const type = oneOf(value.type, ["linear", "radial"] as const, "Invalid gradient type");
  if (value.angle !== undefined) { if (type !== "linear") fail("Only a linear gradient has an angle"); number(value.angle, "gradient angle", 0, 360); }
  if (!Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > 5) fail("A gradient needs 2–5 stops");
  let previous = 0;
  for (const stop of value.stops) {
    record(stop, ["offset", "color"], "gradient stop"); number(stop.offset, "gradient offset", 0, 1); color(stop.color);
    if (stop.offset < previous) fail("Gradient stops must be in order"); previous = stop.offset;
  }
  return value as unknown as Gradient;
}

function validateUserFonts(value: unknown): UserFont[] {
  if (!Array.isArray(value) || !value.length || value.length > USER_FONT_LIMIT) fail("Invalid user fonts list");
  const ids = new Set<string>(), digests = new Set<string>();
  return value.map((item) => {
    record(item, ["id", "family", "file", "sha256", "bytes", "format"], "user font");
    id(item.id, "font id"); string(item.family, "font family", 64); digest(item.sha256);
    number(item.bytes, "font bytes", 1, 20_000_000, true);
    const format = oneOf(item.format, ["ttf", "otf"] as const, "Invalid font format");
    if (item.file !== `fonts/user-${item.sha256}.${format}`) fail("Invalid user font path");
    if (ids.has(item.id) || digests.has(item.sha256)) fail("Duplicate user font"); ids.add(item.id); digests.add(item.sha256);
    return item as unknown as UserFont;
  });
}

export const textObjects = (objects: readonly SceneObject[]): TextObject[] => objects.filter((object): object is TextObject => object.kind === "text");
