import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { TEAM_KNOWLEDGE_TOOLS } from "./team-knowledge-access.js";

const ENTRY_TYPE = "pi67.memory-provenance.v1";
const SHARED_TOOLS = new Set(["viking_shared_search", "viking_shared_read", "viking_sop_search", "viking_sop_read", ...TEAM_KNOWLEDGE_TOOLS]);

/** A migration fence, not a grant of private ownership to unmarked legacy history. */
export function sharedHistoryNeedsAuthorization(manager: Pick<SessionManager, "getEntries" | "getSessionId" | "getHeader">): boolean {
  const entries = manager.getEntries();
  const markers = entries.filter((entry) => entry.type === "custom" && entry.customType === ENTRY_TYPE);
  if (entries.some(hasSharedContent)) return true;
  if (markers.length === 0) return false;
  const marker = markers[0];
  const data = marker?.type === "custom" ? marker.data as Record<string, unknown> | null : null;
  return markers.length !== 1 || data?.version !== 1 || data.kind !== "private"
    || data.originSessionId !== manager.getSessionId() || !!manager.getHeader()?.parentSession;
}

/** Pi JSONL is the authority; never infer private ownership from an empty active branch. */
export function initializePrivateMemoryProvenance(manager: SessionManager): void {
  const entries = manager.getEntries();
  if (entries.some((entry) => entry.type === "custom" && entry.customType === ENTRY_TYPE)) return;
  if (entries.some((entry) => ["message", "compaction", "branch_summary", "custom_message"].includes(entry.type))) return;
  if (manager.getHeader()?.parentSession) return;
  manager.appendCustomEntry(ENTRY_TYPE, { version: 1, kind: "private", originSessionId: manager.getSessionId() });
}

export function markSharedMemoryProvenance(manager: SessionManager): void {
  if (manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === ENTRY_TYPE
    && (entry.data as { kind?: unknown } | undefined)?.kind === "shared-unverified")) return;
  manager.appendCustomEntry(ENTRY_TYPE, { version: 1, kind: "shared-unverified", originSessionId: manager.getSessionId() });
}

export function assertPrivateMemoryProvenance(manager: SessionManager): void {
  const entries = manager.getEntries();
  const provenance = entries.filter((entry) => entry.type === "custom" && entry.customType === ENTRY_TYPE);
  const entry = provenance[0];
  const data = entry?.type === "custom" ? entry.data as Record<string, unknown> | null : null;
  if (provenance.length !== 1 || data?.version !== 1 || data.kind !== "private"
    || data.originSessionId !== manager.getSessionId() || manager.getHeader()?.parentSession
    || entries.some(hasSharedContent)) {
    throw new Error("Private memory requires verified private Session provenance. Shared or unverified history cannot be extracted.");
  }
}

function hasSharedContent(entry: ReturnType<SessionManager["getEntries"]>[number]): boolean {
  if (entry.type !== "message") return false;
  const message = entry.message;
  if (message.role === "toolResult") return SHARED_TOOLS.has(message.toolName);
  return message.role === "assistant" && message.content.some((part) => part.type === "toolCall" && SHARED_TOOLS.has(part.name));
}
