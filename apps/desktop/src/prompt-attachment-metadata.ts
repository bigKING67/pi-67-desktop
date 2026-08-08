import { basename } from "node:path";
import {
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_NAME_CHARS,
  type PromptAttachmentKind,
  type StagedPromptAttachment
} from "@pi67/protocol";

export interface PromptAttachmentManifest extends StagedPromptAttachment {
  version: 1;
  sha256: string;
  stagedAt: number;
}

export function detectMimeType(header: Uint8Array, declared: string, name: string): string {
  if (startsWith(header, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(header, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(header, 0, 4) === "GIF8") return "image/gif";
  if (ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 4) === "WEBP") return "image/webp";
  if (ascii(header, 0, 5) === "%PDF-") return "application/pdf";
  if (startsWith(header, [0x50, 0x4b, 0x03, 0x04])) return officeOrZipMime(name);
  if (startsWith(header, [0x1f, 0x8b])) return "application/gzip";
  return declared || mimeFromExtension(name) || "application/octet-stream";
}

export function attachmentKind(mimeType: string, name: string): PromptAttachmentKind {
  if (mimeType === "image/png" || mimeType === "image/jpeg"
    || mimeType === "image/gif" || mimeType === "image/webp") return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (/zip|gzip|tar|7z|rar/iu.test(mimeType) || /\.(?:zip|tar|tgz|gz)$/iu.test(name)) return "archive";
  if (mimeType.startsWith("text/") || /pdf|word|excel|spreadsheet|presentation|opendocument|rtf|epub/iu.test(mimeType)) {
    return "document";
  }
  return "file";
}

export function assertFileName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PROMPT_ATTACHMENT_NAME_CHARS) {
    throw new Error("Attachment file name is invalid.");
  }
  if (value.includes("\0") || value.includes("/") || value.includes("\\") || basename(value) !== value) {
    throw new Error("Attachment file name must not contain a path.");
  }
  return value;
}

export function assertByteLength(value: unknown, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${name} exceeds the 100 MiB per-file limit.`);
  }
  return Number(value);
}

export function assertOpaqueId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new Error("Prompt attachment id is invalid.");
  }
  return value;
}

export function publicManifest(manifest: PromptAttachmentManifest): StagedPromptAttachment {
  return {
    id: manifest.id,
    name: manifest.name,
    mimeType: manifest.mimeType,
    byteLength: manifest.byteLength,
    kind: manifest.kind
  };
}

export function parsePromptAttachmentManifest(value: unknown): PromptAttachmentManifest | undefined {
  const record = asRecord(value);
  const keys = Object.keys(record);
  const expected = ["version", "id", "name", "mimeType", "byteLength", "kind", "sha256", "stagedAt"];
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(record, key))) return undefined;
  if (
    record.version !== 1
    || typeof record.sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(record.sha256)
    || !Number.isSafeInteger(record.stagedAt)
    || Number(record.stagedAt) < 0
  ) return undefined;
  try {
    const id = assertOpaqueId(record.id);
    const name = assertFileName(record.name);
    const byteLength = assertByteLength(record.byteLength, MAX_PROMPT_ATTACHMENT_BYTES, name);
    const mimeType = typeof record.mimeType === "string" && record.mimeType.length <= 128
      ? record.mimeType
      : undefined;
    if (!mimeType || !["image", "document", "archive", "audio", "video", "file"].includes(String(record.kind))) {
      return undefined;
    }
    return {
      version: 1,
      id,
      name,
      mimeType,
      byteLength,
      kind: record.kind as PromptAttachmentKind,
      sha256: record.sha256,
      stagedAt: Number(record.stagedAt)
    };
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function officeOrZipMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".epub")) return "application/epub+zip";
  return "application/zip";
}

function mimeFromExtension(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (/\.(?:txt|md|markdown|csv|tsv|log|json|jsonl|ya?ml|toml|xml|html?|css|[cm]?[jt]sx?|py|rs|go|java|kt|swift|sql|sh|ps1)$/u.test(lower)) return "text/plain";
  if (lower.endsWith(".rtf")) return "application/rtf";
  if (lower.endsWith(".tar")) return "application/x-tar";
  if (lower.endsWith(".gz") || lower.endsWith(".tgz")) return "application/gzip";
  return undefined;
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
