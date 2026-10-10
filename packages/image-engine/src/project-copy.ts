import * as fs from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./content-store.js";
import { LIMITS, type ImageDocument } from "./document.js";
import { readBytes } from "./raster.js";

/**
 * Lays out a new project folder at `target` (which must already exist and be
 * empty) and copies every file `document` binds — the fonts, each asset and its
 * render — from `sourceRoot`, refusing any whose digest changed. Derived sizes
 * and copy variants both start from this; revisions are the caller's to write.
 */
export async function copyProjectFiles(sourceRoot: string, target: string, document: ImageDocument): Promise<void> {
  for (const folder of ["assets", "fonts", "revisions"]) await fs.mkdir(path.join(target, folder));
  const bindings = new Map<string, string>([[document.font.file, document.font.sha256]]);
  for (const font of document.fonts ?? []) bindings.set(font.file, font.sha256);
  for (const asset of document.assets) { bindings.set(asset.file, asset.sha256); bindings.set(asset.render_file, asset.render_sha256); }
  for (const [file, expected] of bindings) {
    const bytes = await readBytes(path.join(sourceRoot, file), LIMITS.renderBytes);
    if (sha256(bytes) !== expected) throw new Error("Source asset changed during copy");
    await fs.writeFile(path.join(target, file), bytes, { flag: "wx" });
  }
}
