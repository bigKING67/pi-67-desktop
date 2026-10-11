import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Copies the bundled tesseract language data (Simplified Chinese and English) into a
 * private folder tesseract.js can read; OCR never downloads data or calls the network.
 * Shared by prompt-attachment OCR and the image workbench's keyed-text check.
 */
export async function prepareOcrData(root: string): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const require = createRequire(import.meta.url);
  const languages = [
    { language: "eng", packageEntry: require.resolve("@tesseract.js-data/eng") },
    { language: "chi_sim", packageEntry: require.resolve("@tesseract.js-data/chi_sim") }
  ] as const;
  for (const { language, packageEntry } of languages) {
    const source = join(dirname(packageEntry), "4.0.0", `${language}.traineddata.gz`);
    const destination = join(root, `${language}.traineddata.gz`);
    // Copied once, through a private temporary name renamed into place, so a reader running at
    // the same time (attachment OCR, an image text check) never sees a partly written file.
    if (await access(destination).then(() => true, () => false)) continue;
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, temporary);
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return root;
}
