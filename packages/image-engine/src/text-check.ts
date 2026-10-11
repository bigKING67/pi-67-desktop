import sharp, { type OutputInfo } from "sharp";
import { groupOf, isShown, textObjects, type ImageDocument, type TextObject } from "./document.js";

// P4 checkpoint 8: every shown text is read back from the rendered PNG, so text that a layer
// covers, a mask hides, an opacity fades out or the canvas clips is found before it ships.
// The engine crops and compares; the caller brings the OCR (offline tesseract in the Host).

export interface TextCheck {
  object_id: string; text: string; read: string; passed: boolean;
  /**
   * With a text-free background: the WCAG contrast of the text's colour (with its and its group's
   * opacity) against what lies behind its box, and whether that is below the size's minimum.
   */
  contrast?: number; low_contrast?: boolean;
}
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

export async function checkKeyedText(png: Buffer, document: ImageDocument, read: TextReader, background?: Buffer): Promise<TextCheck[]> {
  const texts = textObjects(document.objects).filter((object) => isShown(document, object) && object.opacity > 0 && essence(object.text));
  if (!texts.length) return [];
  // Decoded once; each crop then cuts from raw pixels, one at a time, so a large poster with many texts stays small in memory.
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const crops: Buffer[] = [];
  for (const object of texts) crops.push(await cropOf({ data, info }, document, object));
  const words = await read(crops);
  const behind = background ? await sharp(background).removeAlpha().raw().toBuffer({ resolveWithObject: true }) : undefined;
  return texts.map((object, index) => {
    const seen = words[index] ?? "";
    const check: TextCheck = { object_id: object.id, text: object.text, read: seen.trim(), passed: textMatches(object.text, seen) };
    if (behind) {
      // Judged on the ratio as shown, so `3:1` never reads as too faint beside a 3:1 minimum.
      const contrast = Math.round(boxContrast(behind, document, object) * 10) / 10;
      Object.assign(check, { contrast, low_contrast: contrast < minimumContrast(document, object) });
    }
    return check;
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
  const { cx, cy, halfX, halfY } = rotatedBounds(object);
  const spanX = Math.ceil(halfX * 2) + PAD * 2, spanY = Math.ceil(halfY * 2) + PAD * 2;
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

/**
 * WCAG's minimum: 3:1 for large text, 4.5:1 otherwise. On a poster "large" is relative to the
 * canvas: a font size of at least 1/30 of its short edge (36px on 1080) reads as large wherever it is shown.
 */
function minimumContrast(document: ImageDocument, object: TextObject): number {
  return object.font_size >= Math.min(document.canvas.width, document.canvas.height) / 30 ? 3 : 4.5;
}

/** The axis-aligned bounds of the box as drawn, turned about its centre. */
function rotatedBounds(object: TextObject): { cx: number; cy: number; halfX: number; halfY: number } {
  const turn = Math.abs(object.rotation ?? 0) * Math.PI / 180, cos = Math.abs(Math.cos(turn)), sin = Math.abs(Math.sin(turn));
  return { cx: object.x + object.width / 2, cy: object.y + object.height / 2,
    halfX: (object.width * cos + object.height * sin) / 2, halfY: (object.width * sin + object.height * cos) / 2 };
}

/**
 * The median WCAG contrast, over the box's bounds, of the text's colour — laid over each
 * background pixel at the text's own and its group's opacity — against that pixel. Measured
 * from colours rather than drawn strokes, so anti-aliasing and other texts never move it; a
 * blend mode or mask on the text is judged as if drawn normally (the OCR covers visibility).
 */
function boxContrast(behind: Pixels, document: ImageDocument, object: TextObject): number {
  const { width, height, channels } = behind.info, scale = width / document.canvas.width;
  const { cx, cy, halfX, halfY } = rotatedBounds(object);
  const alpha = object.opacity * (groupOf(document, object)?.opacity ?? 1);
  const ink = [1, 3, 5].map((at) => Number.parseInt(object.color.slice(at, at + 2), 16));
  const ratios: number[] = [];
  const top = Math.max(0, Math.floor((cy - halfY) * scale)), bottom = Math.min(height, Math.max(top + 1, Math.ceil((cy + halfY) * scale)));
  const left = Math.max(0, Math.floor((cx - halfX) * scale)), right = Math.min(width, Math.max(left + 1, Math.ceil((cx + halfX) * scale)));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const at = (y * width + x) * channels;
      const back = [behind.data[at]!, behind.data[at + 1]!, behind.data[at + 2]!];
      const front = luminance(ink.map((value, index) => value * alpha + back[index]! * (1 - alpha))), base = luminance(back);
      ratios.push((Math.max(front, base) + 0.05) / (Math.min(front, base) + 0.05));
    }
  }
  if (!ratios.length) return 21;
  ratios.sort((p, q) => p - q);
  return ratios[Math.floor(ratios.length / 2)]!;
}

/** sRGB channel to linear light, by table: 256 values, looked up per pixel. */
const LINEAR = Array.from({ length: 256 }, (_, value) => { const c = value / 255; return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const linear = (value: number): number => {
  const low = Math.floor(value), share = value - low;
  return share ? LINEAR[low]! * (1 - share) + LINEAR[Math.min(255, low + 1)]! * share : LINEAR[low]!;
};

/** WCAG relative luminance of an sRGB colour (channels may be fractional after blending). */
function luminance([red, green, blue]: number[]): number {
  return 0.2126 * linear(red!) + 0.7152 * linear(green!) + 0.0722 * linear(blue!);
}
