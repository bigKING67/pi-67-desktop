import { TEAM_CHAT_ATTACHMENT_LIMITS, teamChatCodePointLength } from "@pi67/domain";
import type { TeamChatAttachmentSaveRequest } from "./desktop-system-contract.js";

/** Byte-carrying Team Chat messages (ADR 0009), checked outside TypeBox. */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  // Realm-independent: buffers arrive by structured clone from another process.
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/** A chunk carries 1 B to one chunk of bytes that fit inside the declared file. */
export function isValidTeamChatAttachmentChunk(payload: unknown): boolean {
  const chunk = payload as { offset?: unknown; data?: unknown };
  return isArrayBuffer(chunk.data) && chunk.data.byteLength >= 1
    && chunk.data.byteLength <= TEAM_CHAT_ATTACHMENT_LIMITS.chunk
    && Number(chunk.offset) + chunk.data.byteLength <= TEAM_CHAT_ATTACHMENT_LIMITS.bytes;
}

/** The Main save bridge's request: a bounded name and one whole attachment's bytes. */
export function isValidTeamChatAttachmentSave(request: unknown): request is TeamChatAttachmentSaveRequest {
  if (typeof request !== "object" || request === null) return false;
  const { fileName, data } = request as { fileName?: unknown; data?: unknown };
  return typeof fileName === "string" && fileName.length > 0 && teamChatCodePointLength(fileName) <= TEAM_CHAT_ATTACHMENT_LIMITS.fileName
    && isArrayBuffer(data) && data.byteLength >= 1 && data.byteLength <= TEAM_CHAT_ATTACHMENT_LIMITS.bytes;
}

/** A read result's bytes are consistent with its range and `done` flag. */
export function isValidTeamChatAttachmentRead(result: unknown): boolean {
  const read = result as { offset?: unknown; byteLength?: unknown; data?: unknown; done?: unknown };
  if (!isArrayBuffer(read.data) || read.data.byteLength < 1 || read.data.byteLength > TEAM_CHAT_ATTACHMENT_LIMITS.chunk) return false;
  const end = Number(read.offset) + read.data.byteLength;
  return end <= Number(read.byteLength) && read.done === (end === Number(read.byteLength));
}
