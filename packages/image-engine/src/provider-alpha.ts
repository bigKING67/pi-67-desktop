import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import { sha256 } from "./content-store.js";
import { LIMITS } from "./document.js";

export const ALPHA_ERRORS: readonly string[] = ["output_missing_alpha", "output_no_clear_background", "output_empty_foreground"];

export interface AlphaEvidence {
  sha256: string; width: number; height: number; has_alpha: boolean; pixels: number; zero_pixels: number; partial_pixels: number; opaque_pixels: number;
}

// Evidence of actual pixel transparency, not optical quality or product identity.
export async function inspectAlpha(bytes: Buffer): Promise<AlphaEvidence> {
  const meta = await sharp(bytes, { limitInputPixels: LIMITS.pixels, failOn: "warning" }).metadata();
  const { data, info } = await sharp(bytes).toColourspace("srgb").ensureAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  let zero = 0, opaque = 0;
  for (let at = 3; at < data.length; at += 4) {
    if (data[at] === 0) zero++;
    else if (data[at] === 255) opaque++;
  }
  const pixels = info.width * info.height;
  return { sha256: sha256(bytes), width: info.width, height: info.height, has_alpha: meta.hasAlpha === true,
    pixels, zero_pixels: zero, partial_pixels: pixels - zero - opaque, opaque_pixels: opaque };
}

export function requireAlpha(check: AlphaEvidence): AlphaEvidence {
  if (!check.has_alpha) throw new Error("output_missing_alpha");
  if (!check.zero_pixels) throw new Error("output_no_clear_background");
  if (check.zero_pixels === check.pixels) throw new Error("output_empty_foreground");
  return check;
}

export async function verifyAlpha(bytes: Buffer, evidence: unknown): Promise<AlphaEvidence> {
  const actual = requireAlpha(await inspectAlpha(bytes));
  if (!isDeepStrictEqual(actual, evidence)) throw new Error("Transparency evidence differs from output pixels");
  return actual;
}
