import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { errorCode, fail, sha256 } from "./content-store.js";
import type { TextObject } from "./document.js";
import { parseFont, type FontFormat, type ParsedFont } from "./font-parse.js";

export interface FontManifest {
  profile: string; family: string; file: string; sha256: string; bytes: number; weight: number;
  source: string; source_revision: string; license: string; license_file: string;
}

// `fonts/` sits beside both `src/` and `dist/`, so one relative URL serves source tests and the bundle.
const fontsUrl = new URL("../fonts/", import.meta.url);
export const fontDirectory = fileURLToPath(fontsUrl);
export const fontManifest: FontManifest = JSON.parse(readFileSync(new URL("manifest.json", fontsUrl), "utf8")) as FontManifest;

// Hash the 16 MB font once per buffer instead of on every glyph/width check.
const verifiedFonts = new WeakSet<Buffer>();
function verifyFont(bytes: Buffer): void {
  if (verifiedFonts.has(bytes)) return;
  if (bytes.length !== fontManifest.bytes || sha256(bytes) !== fontManifest.sha256) throw new Error("Pinned font digest mismatch");
  verifiedFonts.add(bytes);
}

export async function installedFont(): Promise<Buffer> {
  const file = new URL(fontManifest.file, fontsUrl);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Pinned font must be a regular file");
    const bytes = await fs.readFile(file);
    verifyFont(bytes);
    return bytes;
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw new Error("Pinned font missing: run `corepack pnpm --filter @pi67/image-engine run fetch-font`");
    throw error;
  }
}

const parsed = new WeakMap<Buffer, ParsedFont>();
/** Parses a font buffer once; the pinned font is digest-verified first. */
function fontOf(bytes: Buffer, pinned: boolean): ParsedFont {
  if (pinned) verifyFont(bytes);
  let font = parsed.get(bytes);
  if (!font) { font = parseFont(bytes); parsed.set(bytes, font); }
  return font;
}

/** A user font's format and family name, refusing anything the engine will not render. */
export function inspectUserFont(bytes: Buffer): { format: FontFormat; family: string } {
  const { format, family } = fontOf(bytes, false);
  return { format, family };
}

const SAMPLE = ["A", "a", "0", "字", "あ", "가"];

/** A few characters the user font draws itself, to try it in the renderer before binding it. */
export function userFontSample(bytes: Buffer): string | undefined {
  const font = fontOf(bytes, false);
  const sample = SAMPLE.filter((char) => font.glyph(char.codePointAt(0) ?? 0) !== 0).join("");
  return sample || undefined;
}

/** Every character must have a glyph in the pinned font. */
export function checkGlyphs(bytes: Buffer, texts: readonly string[]): void {
  checkTextGlyphs(bytes, texts.map((text, index) => ({ id: `t${index}`, text })), new Map());
}

/**
 * Each object's characters resolve to a glyph in its own font (a user font named
 * by `font_id`) or, failing that, in the pinned font — the same order the
 * renderer falls back in. Returns each character's advance in em units.
 */
function resolveGlyphs(bytes: Buffer, object: Pick<TextObject, "id" | "text" | "font_id">, userFonts: ReadonlyMap<string, Buffer>, missing: Set<string>): number[] {
  const faces = [...(object.font_id ? [fontOf(userFonts.get(object.font_id) ?? fail(`Missing font for ${object.id}`), false)] : []), fontOf(bytes, true)];
  const advances: number[] = [];
  for (const char of object.text) {
    if (char === "\n") continue;
    const cp = char.codePointAt(0) ?? 0;
    let advance: number | undefined;
    for (const face of faces) {
      const glyph = face.glyph(cp);
      if (glyph !== 0) { advance = face.advance(glyph); break; }
    }
    if (advance === undefined) missing.add(`U+${cp.toString(16).toUpperCase()}`);
    else advances.push(advance);
  }
  return advances;
}

export function checkTextGlyphs(bytes: Buffer, objects: readonly Pick<TextObject, "id" | "text" | "font_id">[], userFonts: ReadonlyMap<string, Buffer>): void {
  const missing = new Set<string>();
  for (const object of objects) resolveGlyphs(bytes, object, userFonts, missing);
  if (missing.size) throw new Error(`Missing font glyphs: ${[...missing].join(", ")}`);
}

/** No single glyph may be wider than its text box (wrapping cannot help it). */
export function checkTextWidths(bytes: Buffer, objects: readonly TextObject[], userFonts: ReadonlyMap<string, Buffer> = new Map()): void {
  const missing = new Set<string>();
  for (const object of objects) {
    for (const advance of resolveGlyphs(bytes, object, userFonts, missing)) {
      if (advance * object.font_size > object.width + 0.1) throw new Error(`Text box narrower than glyph: ${object.id}`);
    }
  }
  if (missing.size) throw new Error(`Missing font glyphs: ${[...missing].join(", ")}`);
}
