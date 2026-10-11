import * as fs from "node:fs/promises";
import path from "node:path";
import { errorCode, sha256, writeOnce } from "./content-store.js";
import { isShown, textObjects, validateDocument, type ImageDocument } from "./document.js";
import { encode } from "./project.js";
import { copyProjectFiles } from "./project-copy.js";
import { compose } from "./render-compose.js";

// A sibling project is a fresh one-revision project written beside its source from one
// source revision: a derived size (P3) or a batch row (P5). Both fit text the same way
// and write the same way; the source is only read.

/** Text may shrink to this share of its starting size before the sibling is refused. */
const MIN_TEXT_SHARE = 0.7;
const TEXT_STEP = 0.05;

/**
 * Shrinks text that overflows its box in 5% steps, down to 70% of its size in
 * `start` (or its current size), validating the result. Returns the ids shrunk, or the
 * refusal in product words when some text still does not fit.
 */
export async function fitText(root: string, font: Buffer, fonts: ReadonlyMap<string, Buffer> | undefined, document: ImageDocument,
  start: ReadonlyMap<string, number> = new Map()): Promise<string[] | string> {
  const shrunk = new Set<string>();
  for (;;) {
    try {
      await compose({ root, font, ...(fonts ? { fonts } : {}), layoutOnly: true, document: { ...document, assets: [], objects: textObjects(document.objects).filter((object) => isShown(document, object)) } });
      break;
    } catch (error) {
      const overflow = /^Text (?:overflow|box narrower than glyph): (.+)$/u.exec(error instanceof Error ? error.message : "");
      const object = overflow ? textObjects(document.objects).find((item) => item.id === overflow[1]) : undefined;
      if (!object) throw error;
      const floor = Math.max(8, Math.ceil((start.get(object.id) ?? object.font_size) * MIN_TEXT_SHARE));
      const next = Math.max(floor, Math.floor(object.font_size * (1 - TEXT_STEP)));
      if (next >= object.font_size) return `文字「${object.text.slice(0, 24)}」在 ${document.canvas.width}×${document.canvas.height} 里放不下`;
      if (!start.has(object.id)) start = new Map([...start, [object.id, object.font_size]]);
      document.objects = document.objects.map((item) => item.id === object.id ? { ...object, font_size: next } : item);
      shrunk.add(object.id);
    }
  }
  validateDocument(document);
  return [...shrunk];
}

/** Writes `document` as revision 1 of a new project at `target`, with the source's files. */
export async function writeSibling(sourceRoot: string, target: string, document: ImageDocument): Promise<Buffer> {
  try { await fs.mkdir(target); }
  catch (error) { if (errorCode(error) === "EEXIST") throw new Error("Derived project already exists"); throw error; }
  const bytes = encode(document);
  try {
    await copyProjectFiles(sourceRoot, target, document);
    await writeOnce(path.join(target, "revisions/000001.json"), { bytes }, { expected: sha256(bytes) });
  } catch (error) {
    // Only this call created the directory; nothing else lives there yet.
    await fs.rm(target, { recursive: true, force: true });
    throw error;
  }
  return bytes;
}
