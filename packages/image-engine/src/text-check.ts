import sharp, { type OutputInfo } from "sharp";
import { isShown, textObjects, type ImageDocument, type TextObject } from "./document.js";

// P4 checkpoint 8: every shown text is read back from the rendered PNG, so text that a layer
// covers, a mask hides, an opacity fades out or the canvas clips is found before it ships.
// The engine crops and compares; the caller brings the OCR (offline tesseract in the Host).

export interface TextCheck { object_id: string; text: string; read: string; passed: boolean }
/** Reads the words in each image, in order. */
export type TextReader = (images: readonly Buffer[]) => Promise<readonly string[]>;

const PAD = 8;
/** Small text is read at twice the size; tesseract misreads strokes under ~32px. */
const SMALL = 32;
/** Share of the expected letters and digits that must be read, in order. */
const PASS = 0.9;

/** Letters and digits only: punctuation, symbols such as ¥ and spacing are not judged. */
const essence = (value: string): string => value.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Passes when at least 90% of the letters and digits are read in order and the digits read are
 * exactly the digits written (a price, a date, a percentage): `1199` never passes for `¥199`.
 */
export function textMatches(expected: string, read: string): boolean {
  const want = Array.from(essence(expected)), got = Array.from(essence(read));
  if (!want.length) return true;
  let previous = Array.from({ length: got.length + 1 }, () => 0);
  for (const char of want) {
    const row = [0];
    for (let index = 1; index <= got.length; index++) row[index] = got[index - 1] === char ? previous[index - 1]! + 1 : Math.max(previous[index]!, row[index - 1]!);
    previous = row;
  }
  const digits = (value: string): string => value.normalize("NFKC").replace(/\P{N}/gu, "");
  return previous[got.length]! / want.length >= PASS && digits(read) === digits(expected);
}

export async function checkKeyedText(png: Buffer, document: ImageDocument, read: TextReader): Promise<TextCheck[]> {
  const texts = textObjects(document.objects).filter((object) => isShown(document, object) && object.opacity > 0 && essence(object.text));
  if (!texts.length) return [];
  // Decoded once; each crop then cuts from raw pixels, one at a time, so a large poster with many texts stays small in memory.
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const crops: Buffer[] = [];
  for (const object of texts) crops.push(await cropOf({ data, info }, document, object));
  const words = await read(crops);
  return texts.map((object, index) => {
    const seen = words[index] ?? "";
    return { object_id: object.id, text: object.text, read: seen.trim(), passed: textMatches(object.text, seen) };
  });
}

interface Pixels { data: Buffer; info: OutputInfo }

/**
 * The text's box with a margin, a turned box cut around its rotated bounds and turned back
 * upright. Where the box runs past the canvas the cut is filled with the background, so the
 * text stays centred and nothing beyond its box is read as part of it.
 */
async function cropOf(pixels: Pixels, document: ImageDocument, object: TextObject): Promise<Buffer> {
  const { width: canvasWidth, height: canvasHeight } = pixels.info;
  const turn = Math.abs(object.rotation ?? 0) * Math.PI / 180, cos = Math.abs(Math.cos(turn)), sin = Math.abs(Math.sin(turn));
  const cx = object.x + object.width / 2, cy = object.y + object.height / 2;
  const spanX = Math.ceil(object.width * cos + object.height * sin) + PAD * 2, spanY = Math.ceil(object.width * sin + object.height * cos) + PAD * 2;
  const want = { left: Math.round(cx - spanX / 2), top: Math.round(cy - spanY / 2) };
  const left = clamp(want.left, canvasWidth - 1), top = clamp(want.top, canvasHeight - 1);
  const right = Math.max(left + 1, Math.min(canvasWidth, want.left + spanX)), bottom = Math.max(top + 1, Math.min(canvasHeight, want.top + spanY));
  const fill = { left: left - want.left, top: top - want.top, right: Math.max(0, want.left + spanX - right), bottom: Math.max(0, want.top + spanY - bottom) };
  const raw = { width: pixels.info.width, height: pixels.info.height, channels: pixels.info.channels };
  let image = sharp(await sharp(pixels.data, { raw }).extract({ left, top, width: right - left, height: bottom - top })
    .extend({ ...fill, background: document.canvas.background }).png().toBuffer());
  // Flips are undone too, so mirrored words read the right way round.
  if (object.flip_x) image = image.flop();
  if (object.flip_y) image = image.flip();
  if (!object.rotation) return image.resize(scaled(object, { height: spanY })).png().toBuffer();
  const upright = await sharp(await image.png().toBuffer()).rotate(-(object.rotation * (object.flip_x !== object.flip_y ? -1 : 1)), { background: document.canvas.background }).png().toBuffer();
  const { width, height } = await sharp(upright).metadata();
  const box = { width: Math.min(width, object.width + PAD * 2), height: Math.min(height, object.height + PAD * 2) };
  return sharp(upright).extract({ left: Math.floor((width - box.width) / 2), top: Math.floor((height - box.height) / 2), ...box }).resize(scaled(object, box)).png().toBuffer();
}

const scaled = (object: TextObject, box: { height: number }): { height?: number } => object.font_size < SMALL ? { height: box.height * 2 } : {};
const clamp = (value: number, max: number): number => Math.min(Math.max(0, value), Math.max(0, max));
