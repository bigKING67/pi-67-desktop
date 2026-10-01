import type { OVClient } from "./client.js";
import type { OVConfig } from "./config.js";
import type { SyncManager } from "./sync.js";

/**
 * Pi ends the outgoing Session for these reasons; `reload` keeps it alive, so
 * archiving there would split one conversation into extraction fragments.
 */
const ENDED_SESSION_REASONS = new Set(["quit", "new", "resume", "fork"]);

/**
 * App quit gives every loaded Task's shutdown handlers about two seconds in
 * total. Commit acceptance is a local archive write and extraction runs from
 * OpenViking's durable queue, so a bounded wait loses at most this one Commit.
 */
export const SHUTDOWN_COMMIT_DEADLINE_MS = 1500;

export type ShutdownCommitOutcome =
  | "not-ended" | "no-session" | "unflushed" | "below-threshold" | "committed" | "failed" | "timeout";

/**
 * Takeover only commits under context pressure, so ordinary conversations never
 * reached memory extraction. When a Session really ends with enough uncommitted
 * content, archive all of it: Pi JSONL stays the conversation source of truth and
 * the takeover boundary is persisted separately, so no live tail is needed.
 * Callers keep privacy, ownership, and connection gates in front of this.
 */
export async function commitEndedSession(
  reason: unknown,
  sync: Pick<SyncManager, "sessionId" | "flushForTakeover" | "commit">,
  client: Pick<OVClient, "getSession">,
  config: Pick<OVConfig, "shutdownCommitMinTokens">,
  deadlineMs = SHUTDOWN_COMMIT_DEADLINE_MS,
): Promise<ShutdownCommitOutcome> {
  if (typeof reason !== "string" || !ENDED_SESSION_REASONS.has(reason)) return "not-ended";
  const sessionId = sync.sessionId;
  if (!sessionId) return "no-session";
  const work = (async (): Promise<ShutdownCommitOutcome> => {
    if (!await sync.flushForTakeover()) return "unflushed";
    const meta = await client.getSession(sessionId);
    if (Number(meta?.pending_tokens ?? 0) < config.shutdownCommitMinTokens) return "below-threshold";
    return await sync.commit({ keepRecentCount: 0 }) ? "committed" : "failed";
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ShutdownCommitOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deadlineMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
