import type { OVClient } from "./client.js";
import type { OVConfig } from "./config.js";
import type { SyncManager } from "./sync.js";

/**
 * Takeover commits only under context pressure (30,000 tokens) or before
 * compaction, so ordinary conversations never reached memory extraction. These
 * two policies add memory-driven Commit points; privacy, ownership and
 * connection gates stay with the callers, and SyncManager's single-flight guard
 * keeps them from racing takeover or an explicit Desktop Commit.
 */
type CommitSync = Pick<SyncManager, "sessionId" | "flushForTakeover" | "commit">;
type SessionReader = Pick<OVClient, "getSession">;

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

export type SessionCommitOutcome =
  | "not-ended" | "no-session" | "unflushed" | "below-threshold" | "committed" | "failed" | "timeout";

/**
 * An ended Session with enough uncommitted content is archived in full: Pi
 * JSONL stays the conversation source of truth and the takeover boundary is
 * persisted separately, so no live tail is needed.
 */
export async function commitEndedSession(
  reason: unknown,
  sync: CommitSync,
  client: SessionReader,
  config: Pick<OVConfig, "shutdownCommitMinTokens">,
  deadlineMs = SHUTDOWN_COMMIT_DEADLINE_MS,
): Promise<SessionCommitOutcome> {
  if (typeof reason !== "string" || !ENDED_SESSION_REASONS.has(reason)) return "not-ended";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SessionCommitOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deadlineMs);
  });
  try {
    return await Promise.race([commitPending(sync, client, config.shutdownCommitMinTokens, 0), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Workbench Tasks stay loaded while the user switches between them, so a
 * long-open conversation may not end for days. Between prompts, commit once the
 * backlog is large, keeping the takeover live tail so the next prompt still sees
 * the recent turns verbatim.
 */
export function commitLongSession(
  sync: CommitSync,
  client: SessionReader,
  config: Pick<OVConfig, "activeCommitMinTokens" | "takeoverKeepRecentTurns">,
): Promise<SessionCommitOutcome> {
  return commitPending(sync, client, config.activeCommitMinTokens, { keepRecentTurns: config.takeoverKeepRecentTurns });
}

async function commitPending(
  sync: CommitSync,
  client: SessionReader,
  minTokens: number,
  retention: 0 | { keepRecentTurns: number },
): Promise<SessionCommitOutcome> {
  const sessionId = sync.sessionId;
  if (!sessionId) return "no-session";
  if (!await sync.flushForTakeover()) return "unflushed";
  const meta = await client.getSession(sessionId);
  if (Number(meta?.pending_tokens ?? 0) < minTokens) return "below-threshold";
  const committed = await sync.commit(retention === 0 ? { keepRecentCount: 0 } : retention);
  return committed ? "committed" : "failed";
}
