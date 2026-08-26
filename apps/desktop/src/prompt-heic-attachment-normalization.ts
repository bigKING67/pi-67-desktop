import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PromptAttachmentNormalization } from "@pi67/protocol";
import type { PromptImageNormalizer } from "./prompt-image-normalization-client.js";
import {
  inspectPromptHeif,
  inspectPromptJpeg,
  MAX_PROMPT_HEIC_SOURCE_BYTES,
  promptJpegName,
  stripPromptJpegMetadata
} from "./prompt-image-inspection.js";

interface PromptHeicSource {
  name: string;
  mimeType: string;
  byteLength: number;
}

export interface PromptHeicNormalizationResult {
  name: string;
  mimeType: "image/jpeg";
  byteLength: number;
  sha256: string;
  normalization: PromptAttachmentNormalization;
}

export async function normalizePromptHeicAttachment(options: {
  source: PromptHeicSource;
  copiedByteLength: number;
  metadataBytes: Uint8Array;
  payloadPath: string;
  directory: string;
  normalizer: PromptImageNormalizer;
  signal: AbortSignal;
}): Promise<PromptHeicNormalizationResult | undefined> {
  const heif = inspectPromptHeif(options.metadataBytes);
  if (!heif && claimsHeic(options.source.mimeType, options.source.name)) {
    throw new Error("无法从文件内容确认 HEIC/HEIF 图片，文件可能损坏或扩展名不匹配，草稿已保留，请重新选择。");
  }
  if (!heif) return undefined;
  if (options.copiedByteLength > MAX_PROMPT_HEIC_SOURCE_BYTES) {
    throw new Error("HEIC/HEIF 图片超过 32 MiB 源文件上限，草稿已保留，请压缩后重试。");
  }

  const result = await options.normalizer.normalize(
    options.payloadPath,
    options.copiedByteLength,
    options.signal
  );
  const strippedBytes = stripPromptJpegMetadata(result.bytes);
  const output = inspectPromptJpeg(strippedBytes);
  if (output.width !== result.width || output.height !== result.height) {
    throw new Error("HEIC/HEIF 转换后的 JPEG 尺寸校验失败，草稿已保留，请重试。");
  }
  const temporaryPayload = join(options.directory, "payload.normalized.tmp");
  await writeFile(temporaryPayload, strippedBytes, { mode: 0o600, flag: "wx" });
  await rename(temporaryPayload, options.payloadPath);
  return {
    name: promptJpegName(options.source.name),
    mimeType: "image/jpeg",
    byteLength: strippedBytes.byteLength,
    sha256: createHash("sha256").update(strippedBytes).digest("hex"),
    normalization: normalizationReceipt(options.source)
  };
}

function normalizationReceipt(source: PromptHeicSource): PromptAttachmentNormalization {
  return {
    kind: "heic-to-jpeg",
    sourceName: source.name,
    sourceMimeType: source.mimeType,
    sourceByteLength: source.byteLength
  };
}

function claimsHeic(mimeType: string, name: string): boolean {
  return mimeType === "image/heic" || mimeType === "image/heif"
    || mimeType === "image/heic-sequence" || mimeType === "image/heif-sequence"
    || /\.(?:heic|heif|hif)$/iu.test(name);
}
