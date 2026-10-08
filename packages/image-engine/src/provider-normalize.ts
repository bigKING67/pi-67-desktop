import sharp from "sharp";
import { sha256 } from "./content-store.js";
import { LIMITS } from "./document.js";

export type OutputPolicy = "strict" | "resize_to_target";
export interface Normalization {
  policy: OutputPolicy; source_sha256: string; output_sha256: string; source_size: [number, number]; target_size: [number, number]; kernel: "lanczos3"; crop: false;
}

// Explicit full-frame resampling only. Never silently crop, stretch or assume
// that a gateway returning a native size honored the requested dimensions.
export async function normalizeImage(bytes: Buffer, width: number, height: number, policy: OutputPolicy = "strict"): Promise<{ bytes: Buffer; normalization: Normalization | null }> {
  if (!["strict", "resize_to_target"].includes(policy)) throw new Error("Unsupported output policy");
  const { info } = await sharp(bytes, { limitInputPixels: LIMITS.pixels, failOn: "warning" }).raw().toBuffer({ resolveWithObject: true });
  const meta = await sharp(bytes).metadata();
  if (meta.format !== "png" || (meta.pages ?? 1) !== 1 || meta.depth !== "uchar") throw new Error("output_dimensions_or_format_mismatch");
  if (info.width === width && info.height === height) return { bytes, normalization: null };
  if (policy !== "resize_to_target" || info.width * height !== info.height * width) throw new Error("output_dimensions_or_format_mismatch");
  const resized = await sharp(bytes).toColourspace("srgb").resize(width, height, { fit: "fill", kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();
  if (resized.length > LIMITS.renderBytes) throw new Error("invalid_image_size");
  return { bytes: resized, normalization: { policy, source_sha256: sha256(bytes), output_sha256: sha256(resized), source_size: [info.width, info.height], target_size: [width, height], kernel: "lanczos3", crop: false } };
}
