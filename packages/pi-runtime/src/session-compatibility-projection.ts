import {
  CURRENT_SESSION_VERSION,
  sessionEntryToContextMessages,
  type SessionEntry,
  type SessionManager
} from "@earendil-works/pi-coding-agent";
import type { SessionCompatibilityView } from "@pi67/domain";

const KNOWN_ENTRY_TYPES = new Set([
  "message",
  "thinking_level_change",
  "model_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info"
]);

export function projectSessionCompatibility(
  manager: Pick<SessionManager, "getHeader">,
  entries: readonly SessionEntry[]
): SessionCompatibilityView {
  const headerVersion = manager.getHeader()?.version;
  const sessionFormatVersion = Number.isSafeInteger(headerVersion) && (headerVersion ?? 0) > 0
    ? Math.trunc(headerVersion!)
    : 1;
  let unknownEntryCount = 0;
  let unrenderableMessageCount = 0;
  for (const entry of entries) {
    if (!KNOWN_ENTRY_TYPES.has(entry.type)) {
      unknownEntryCount += 1;
      continue;
    }
    if (!isExpectedVisibleMessageEntry(entry)) continue;
    try {
      if (sessionEntryToContextMessages(entry).length === 0) unrenderableMessageCount += 1;
    } catch {
      unrenderableMessageCount += 1;
    }
  }
  const futureFormat = sessionFormatVersion > CURRENT_SESSION_VERSION;
  return {
    status: futureFormat
      ? "future-format"
      : unknownEntryCount > 0 || unrenderableMessageCount > 0
        ? "partial"
        : "compatible",
    currentSupportedVersion: CURRENT_SESSION_VERSION,
    sessionFormatVersion,
    unknownEntryCount,
    unrenderableMessageCount,
    mutationSafe: true
  };
}

function isExpectedVisibleMessageEntry(entry: SessionEntry): boolean {
  if (entry.type === "message") return true;
  return entry.type === "custom_message" && entry.display === true;
}
