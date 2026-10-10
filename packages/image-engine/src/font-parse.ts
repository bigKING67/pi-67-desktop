// A strict, bounds-checked reader for the few tables the engine needs from a
// font: the character map, horizontal advances and the family name. User fonts
// are untrusted files, so every offset is checked against the buffer before it
// is read, and anything outside plain TrueType/OpenType (collections, WOFF,
// WOFF2, Apple 'true') is refused before a renderer ever sees the bytes.

export const USER_FONT_MAX_BYTES = 20_000_000;
const MAX_TABLES = 64;
const MAX_CMAP_GROUPS = 100_000;

export type FontFormat = "ttf" | "otf";

export interface ParsedFont {
  format: FontFormat;
  family: string;
  /** The glyph index for a code point; 0 when the font has none. */
  glyph(codePoint: number): number;
  /** A glyph's advance width in em units (advance ÷ unitsPerEm). */
  advance(glyph: number): number;
}

class FontError extends Error {}
const bad = (reason: string): never => { throw new FontError(`Unsupported font file: ${reason}`); };

export function parseFont(bytes: Buffer): ParsedFont {
  if (bytes.length < 12 || bytes.length > USER_FONT_MAX_BYTES) bad("size");
  const u16 = (at: number): number => { if (at < 0 || at + 2 > bytes.length) bad("truncated"); return bytes.readUInt16BE(at); };
  const u32 = (at: number): number => { if (at < 0 || at + 4 > bytes.length) bad("truncated"); return bytes.readUInt32BE(at); };
  const tag = bytes.toString("latin1", 0, 4);
  const format: FontFormat = tag === "OTTO" ? "otf" : u32(0) === 0x00010000 ? "ttf" : bad(tag === "ttcf" ? "font collections are not supported" : "not TrueType or OpenType");

  const count = u16(4);
  if (count === 0 || count > MAX_TABLES) bad("table count");
  const tables = new Map<string, { offset: number; length: number }>();
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16;
    const name = bytes.toString("latin1", at, at + 4), offset = u32(at + 8), length = u32(at + 12);
    if (offset + length > bytes.length) bad(`table ${name} outside the file`);
    tables.set(name, { offset, length });
  }
  const table = (name: string, minimum: number) => {
    const found = tables.get(name);
    if (!found || found.length < minimum) bad(`missing ${name} table`);
    return found as { offset: number; length: number };
  };

  const head = table("head", 54), hhea = table("hhea", 36), maxp = table("maxp", 6), hmtx = table("hmtx", 4), cmap = table("cmap", 4);
  const unitsPerEm = u16(head.offset + 18);
  if (unitsPerEm < 16 || unitsPerEm > 16384) bad("units per em");
  const glyphCount = u16(maxp.offset + 4), metrics = u16(hhea.offset + 34);
  if (glyphCount === 0 || metrics === 0 || metrics > glyphCount || metrics * 4 > hmtx.length) bad("horizontal metrics");

  const lookup = characterMap(bytes, cmap, u16, u32);
  return {
    format,
    family: familyName(bytes, tables.get("name"), u16) ?? "自定义字体",
    glyph: (codePoint) => { const glyph = lookup(codePoint); return glyph > 0 && glyph < glyphCount ? glyph : 0; },
    advance: (glyph) => u16(hmtx.offset + Math.min(glyph, metrics - 1) * 4) / unitsPerEm
  };
}

type Reader = (at: number) => number;

/** Picks a Unicode subtable (format 12 preferred, else format 4) and returns its lookup. */
function characterMap(bytes: Buffer, cmap: { offset: number; length: number }, u16: Reader, u32: Reader): (codePoint: number) => number {
  const end = cmap.offset + cmap.length;
  let format12: number | undefined, format4: number | undefined;
  const records = u16(cmap.offset + 2);
  if (records > 64) bad("cmap records");
  for (let index = 0; index < records; index++) {
    const at = cmap.offset + 4 + index * 8, platform = u16(at), encoding = u16(at + 2), offset = cmap.offset + u32(at + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || offset + 2 > end) continue;
    const kind = u16(offset);
    if (kind === 12) format12 ??= offset;
    if (kind === 4) format4 ??= offset;
  }
  if (format12 !== undefined) {
    const at = format12, length = u32(at + 4), groups = u32(at + 12);
    if (groups > MAX_CMAP_GROUPS || at + length > end || 16 + groups * 12 > length) bad("cmap format 12");
    return (codePoint) => {
      let low = 0, high = groups - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1, group = at + 16 + mid * 12;
        const start = u32(group), stop = u32(group + 4);
        if (codePoint < start) high = mid - 1;
        else if (codePoint > stop) low = mid + 1;
        else return u32(group + 8) + codePoint - start;
      }
      return 0;
    };
  }
  if (format4 !== undefined) {
    const at = format4, length = u16(at + 2), segments = u16(at + 6) / 2;
    if (!Number.isInteger(segments) || segments === 0 || at + length > end || 16 + segments * 8 > length) bad("cmap format 4");
    const ends = at + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
    return (codePoint) => {
      if (codePoint > 0xffff) return 0;
      for (let segment = 0; segment < segments; segment++) {
        if (codePoint > u16(ends + segment * 2)) continue;
        const start = u16(starts + segment * 2);
        if (codePoint < start) return 0;
        const delta = u16(deltas + segment * 2), rangeAt = ranges + segment * 2, range = u16(rangeAt);
        if (range === 0) return (codePoint + delta) & 0xffff;
        const glyphAt = rangeAt + range + (codePoint - start) * 2;
        if (glyphAt + 2 > at + length) return 0;
        const glyph = u16(glyphAt);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
      return 0;
    };
  }
  return bad("no Unicode character map");
}

const NAME_IDS = [1, 2, 16, 17] as const;
const PLAIN_STYLE = /^(?:regular|normal|book|roman|standard)$/iu;

/**
 * The family name plus its style when it is not the plain one (`Brand Bold`), so two
 * weights of one family stay apart in the picker. Windows UTF-16 records win; a Mac
 * record is used only when it is Roman-encoded ASCII, never guessed at.
 */
function familyName(bytes: Buffer, name: { offset: number; length: number } | undefined, u16: Reader): string | undefined {
  if (!name || name.length < 6) return undefined;
  const count = u16(name.offset + 2), strings = name.offset + u16(name.offset + 4);
  const windows = new Map<number, string>(), mac = new Map<number, string>();
  for (let index = 0; index < Math.min(count, 512); index++) {
    const at = name.offset + 6 + index * 12;
    if (at + 12 > name.offset + name.length) break;
    const platform = u16(at), encoding = u16(at + 2), id = u16(at + 6), length = u16(at + 8), offset = strings + u16(at + 10);
    if (!(NAME_IDS as readonly number[]).includes(id) || offset + length > name.offset + name.length || length === 0 || length > 256) continue;
    const raw = bytes.subarray(offset, offset + length);
    const text = platform === 3 && length % 2 === 0 ? Buffer.from(raw).swap16().toString("utf16le")
      : platform === 1 && encoding === 0 && raw.every((byte) => byte >= 0x20 && byte < 0x7f) ? raw.toString("latin1") : undefined;
    const clean = text?.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 64);
    const into = platform === 3 ? windows : mac;
    if (clean && !into.has(id)) into.set(id, clean);
  }
  const pick = (id: number) => windows.get(id) ?? mac.get(id);
  const typographic = pick(16) !== undefined;
  const family = typographic ? pick(16) : pick(1), style = typographic ? pick(17) ?? pick(2) : pick(2);
  if (!family) return undefined;
  return (style && !PLAIN_STYLE.test(style) ? `${family} ${style}` : family).slice(0, 64);
}

