import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { errorCode, sha256 } from "./content-store.js";
import type { TextObject } from "./document.js";

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

function tableOffsets(bytes: Buffer): Map<string, number> {
  const tables = new Map<string, number>();
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    tables.set(bytes.toString("ascii", at, at + 4), bytes.readUInt32BE(at + 8));
  }
  return tables;
}

// This parser is used only after the exact, fixed OTF digest is verified.
// Its format-12 cmap covers the font's BMP and supplementary characters.
export function checkGlyphs(bytes: Buffer, texts: readonly string[]): Map<number, number> {
  verifyFont(bytes);
  const cmap = tableOffsets(bytes).get("cmap");
  if (cmap === undefined) throw new Error("Pinned font cmap profile changed");
  let table: number | undefined;
  for (let i = 0; i < bytes.readUInt16BE(cmap + 2); i++) {
    const at = cmap + 4 + i * 8;
    const offset = cmap + bytes.readUInt32BE(at + 4);
    if (bytes.readUInt16BE(offset) === 12) table = offset;
  }
  if (table === undefined) throw new Error("Pinned font cmap profile changed");
  const groups = bytes.readUInt32BE(table + 12);
  const missing = new Set<string>();
  const glyphs = new Map<number, number>();
  for (const char of texts.join("")) {
    if (char === "\n") continue;
    const cp = char.codePointAt(0) ?? 0;
    let low = 0, high = groups - 1, found = false;
    while (low <= high) {
      const mid = (low + high) >>> 1, at = table + 16 + mid * 12;
      const start = bytes.readUInt32BE(at), end = bytes.readUInt32BE(at + 4);
      if (cp < start) high = mid - 1;
      else if (cp > end) low = mid + 1;
      else { const glyph = bytes.readUInt32BE(at + 8) + cp - start; found = glyph !== 0; glyphs.set(cp, glyph); break; }
    }
    if (!found) missing.add(`U+${cp.toString(16).toUpperCase()}`);
  }
  if (missing.size) throw new Error(`Missing font glyphs: ${[...missing].join(", ")}`);
  return glyphs;
}

export function checkTextWidths(bytes: Buffer, objects: readonly TextObject[]): void {
  const glyphs = checkGlyphs(bytes, objects.map((object) => object.text));
  const tables = tableOffsets(bytes);
  const head = tables.get("head"), hhea = tables.get("hhea"), hmtx = tables.get("hmtx");
  if (head === undefined || hhea === undefined || hmtx === undefined) throw new Error("Pinned font metric tables changed");
  const units = bytes.readUInt16BE(head + 18);
  const count = bytes.readUInt16BE(hhea + 34);
  for (const object of objects) for (const char of object.text) {
    if (char === "\n") continue;
    const glyph = glyphs.get(char.codePointAt(0) ?? 0) ?? 0;
    const advance = bytes.readUInt16BE(hmtx + Math.min(glyph, count - 1) * 4);
    if (advance / units * object.font_size > object.width + 0.1) throw new Error(`Text box narrower than glyph: ${object.id}`);
  }
}
