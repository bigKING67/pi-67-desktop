import { MAX_PROMPT_ATTACHMENT_NAME_CHARS } from "@pi67/protocol";

export const MAX_PROMPT_HEIC_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_PROMPT_HEIC_METADATA_BYTES = 1024 * 1024;
const MAX_PROMPT_HEIC_PIXELS = 50_000_000;
const MAX_PROMPT_HEIC_DIMENSION = 16_384;
export const PROMPT_HEIC_JPEG_QUALITY = 90;

const SUPPORTED_HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "mif1",
  "msf1"
]);
const HEIF_BRANDS = new Set([
  ...SUPPORTED_HEIF_BRANDS,
  "heim",
  "heis",
  "hevm",
  "hevs"
]);
const CONTAINER_BOXES = new Set(["iprp", "ipco"]);

export interface PromptHeifInspection {
  brand: string;
  width: number;
  height: number;
}

export interface PromptJpegInspection {
  width: number;
  height: number;
}

export function inspectPromptHeif(bytes: Uint8Array): PromptHeifInspection | undefined {
  const first = readBox(bytes, 0, bytes.byteLength);
  if (!first || first.type !== "ftyp" || first.headerBytes !== 8 || first.contentEnd - first.contentStart < 8) {
    return undefined;
  }
  const majorBrand = ascii(bytes, first.contentStart, 4);
  const compatibleBrands: string[] = [];
  for (let offset = first.contentStart + 8; offset + 4 <= first.contentEnd; offset += 4) {
    compatibleBrands.push(ascii(bytes, offset, 4));
  }
  const recognizedBrand = [majorBrand, ...compatibleBrands].find((brand) => HEIF_BRANDS.has(brand));
  if (!recognizedBrand) return undefined;
  if (!SUPPORTED_HEIF_BRANDS.has(majorBrand)) {
    throw new Error("该 HEIF 图片使用了当前不支持的编码品牌，草稿已保留，请换一张图片重试。");
  }

  const dimensions = findHeifDimensions(bytes, first.contentEnd, bytes.byteLength);
  if (!dimensions) {
    throw new Error("无法在 1 MiB 元数据边界内确认 HEIC/HEIF 图片尺寸，草稿已保留，请重新选择重试。");
  }
  assertPromptImageDimensions(dimensions.width, dimensions.height);
  return { brand: majorBrand, ...dimensions };
}

export function inspectPromptJpeg(bytes: Uint8Array): PromptJpegInspection {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new Error("HEIC/HEIF 转换没有生成完整 JPEG 图片。");
  }
  let offset = 2;
  let dimensions: PromptJpegInspection | undefined;
  while (offset < bytes.byteLength - 2) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0x00) throw new Error("转换后的 JPEG 标记无效。");
    if (marker === 0xd9) break;
    if (marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) throw new Error("转换后的 JPEG 段不完整。");
    const segmentLength = readUint16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      throw new Error("转换后的 JPEG 段长度无效。");
    }
    if (marker === 0xe1 || marker === 0xe2 || marker === 0xed || marker === 0xfe) {
      throw new Error("转换后的 JPEG 仍包含不允许保留的元数据。");
    }
    if (isStartOfFrame(marker)) {
      if (segmentLength < 7) throw new Error("转换后的 JPEG 尺寸段无效。");
      dimensions = {
        height: readUint16(bytes, offset + 3),
        width: readUint16(bytes, offset + 5)
      };
    }
    offset += segmentLength;
  }
  if (!dimensions) throw new Error("转换后的 JPEG 缺少可验证的图片尺寸。");
  assertPromptImageDimensions(dimensions.width, dimensions.height);
  return dimensions;
}

export function stripPromptJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new Error("HEIC/HEIF 转换没有生成完整 JPEG 图片。");
  }
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.byteLength - 2) {
    const markerStart = offset;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0x00) throw new Error("转换后的 JPEG 标记无效。");
    if (marker === 0xda) {
      parts.push(bytes.subarray(markerStart));
      return concatBytes(parts);
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(markerStart, offset));
      return concatBytes(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(markerStart, offset));
      continue;
    }
    if (offset + 2 > bytes.byteLength) throw new Error("转换后的 JPEG 段不完整。");
    const segmentLength = readUint16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      throw new Error("转换后的 JPEG 段长度无效。");
    }
    const segmentEnd = offset + segmentLength;
    if (marker !== 0xe1 && marker !== 0xe2 && marker !== 0xed && marker !== 0xfe) {
      parts.push(bytes.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;
  }
  throw new Error("转换后的 JPEG 缺少图片数据段。");
}

export function assertPromptImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width > MAX_PROMPT_HEIC_DIMENSION || height > MAX_PROMPT_HEIC_DIMENSION
    || width * height > MAX_PROMPT_HEIC_PIXELS) {
    throw new Error("HEIC/HEIF 图片超过 5,000 万像素或 16,384 像素单边上限，草稿已保留，请缩小后重试。");
  }
}

export function promptJpegName(sourceName: string): string {
  const dot = sourceName.lastIndexOf(".");
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  const boundedBase = base.slice(0, Math.max(1, MAX_PROMPT_ATTACHMENT_NAME_CHARS - ".jpg".length));
  return `${boundedBase}.jpg`;
}

function findHeifDimensions(
  bytes: Uint8Array,
  start: number,
  end: number
): { width: number; height: number } | undefined {
  for (let offset = start; offset < end;) {
    const box = readBox(bytes, offset, end);
    if (!box) return undefined;
    if (box.type === "meta") {
      return findIspe(bytes, box.contentStart + 4, box.contentEnd);
    }
    offset = box.end;
  }
  return undefined;
}

function findIspe(
  bytes: Uint8Array,
  start: number,
  end: number,
  depth = 0
): { width: number; height: number } | undefined {
  if (depth > 4 || start > end) return undefined;
  for (let offset = start; offset < end;) {
    const box = readBox(bytes, offset, end);
    if (!box) return undefined;
    if (box.type === "ispe") {
      if (box.contentEnd - box.contentStart < 12) return undefined;
      return {
        width: readUint32(bytes, box.contentStart + 4),
        height: readUint32(bytes, box.contentStart + 8)
      };
    }
    if (CONTAINER_BOXES.has(box.type)) {
      const found = findIspe(bytes, box.contentStart, box.contentEnd, depth + 1);
      if (found) return found;
    }
    offset = box.end;
  }
  return undefined;
}

function readBox(
  bytes: Uint8Array,
  offset: number,
  boundary: number
): {
  type: string;
  headerBytes: number;
  contentStart: number;
  contentEnd: number;
  end: number;
} | undefined {
  if (offset < 0 || offset + 8 > boundary || boundary > bytes.byteLength) return undefined;
  const size32 = readUint32(bytes, offset);
  const type = ascii(bytes, offset + 4, 4);
  let headerBytes = 8;
  let size = size32;
  if (size32 === 1) {
    if (offset + 16 > boundary) return undefined;
    const high = readUint32(bytes, offset + 8);
    const low = readUint32(bytes, offset + 12);
    const wideSize = high * 2 ** 32 + low;
    if (!Number.isSafeInteger(wideSize)) return undefined;
    headerBytes = 16;
    size = wideSize;
  } else if (size32 === 0) {
    size = boundary - offset;
  }
  if (size < headerBytes || offset + size > boundary) return undefined;
  return {
    type,
    headerBytes,
    contentStart: offset + headerBytes,
    contentEnd: offset + size,
    end: offset + size
  };
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf
    && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 2 ** 24)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index] ?? 0);
  }
  return value;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
