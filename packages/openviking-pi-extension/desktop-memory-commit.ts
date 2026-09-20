import type { ExtensionAPI } from "@pi67/pi-runtime/pi-sdk-types";
import type { OVClient } from "./client.js";
import type { SyncManager } from "./sync.js";
import { observeDesktopCommit } from "./desktop-commit-outcome.js";

interface CommitRequest { sessionId: string; canCommit: () => boolean; }

/** Only the loaded Extension can resolve Pi identity to its current OV lineage. */
export function registerDesktopMemoryCommit(
  pi: ExtensionAPI, client: OVClient, sync: SyncManager, refreshPrivacy: () => boolean
): void {
  let active = true;
  const unsubscribe = pi.events.on("pi67:private-memory:commit", (value) => {
    if (!value || typeof value !== "object" || !("provide" in value) || typeof value.provide !== "function") return;
    value.provide(async (request: CommitRequest) => {
      const allowed = () => active && typeof request?.canCommit === "function" && request.canCommit()
        && request.sessionId === sync.piSessionId && refreshPrivacy()
        && client.cfg.privateWriteEnabled && !sync.blockedReason;
      if (!allowed()) throw blocked();
      if (!await client.ensureConnected() || !allowed()) throw blocked();
      if (!await sync.flushForTakeover() || !allowed()) throw blocked();
      const lineage = sync.sessionId;
      // No implicit retry queue for an explicit Commit. The Host tracks its
      // accepted result; a transport ambiguity requires a new explicit action.
      const result = await sync.commit({ queueOnFailure: false,
        ...(client.cfg.takeoverEnabled ? { keepRecentTurns: client.cfg.takeoverKeepRecentTurns } : {}) });
      if (!result || typeof result.status !== "string" || typeof result.archived !== "boolean") throw blocked();
      const extraction = result.archived && client.usesManagedConnection && lineage
        ? await observeDesktopCommit(client, result, lineage, () => allowed() && sync.sessionId === lineage).catch(() => "unconfirmed" as const)
        : undefined;
      return { status: result.status, archived: result.archived,
        ...(result.reason === "all_within_keep_window" || result.reason === "no_messages" ? { reason: result.reason } : {}),
        ...(extraction === undefined ? {} : { extraction }),
        // Managed sidecar jobs must not be polled through the legacy external
        // candidate gateway. Managed candidate tracking is a separate cutover.
        ...(client.usesManagedConnection || result.task_id === undefined ? {} : { task_id: result.task_id }) };
    });
  });
  const unsubscribeInspection = pi.events.on("pi67:private-memory:inspect", (value) => {
    if (!value || typeof value !== "object" || !("provide" in value) || typeof value.provide !== "function") return;
    value.provide(async (request: { sessionId: string; isCurrent: () => boolean }) => {
      const allowed = () => active && typeof request?.isCurrent === "function" && request.isCurrent()
        && request.sessionId === sync.piSessionId && refreshPrivacy() && !sync.blockedReason;
      const lineage = sync.sessionId;
      if (!allowed() || !lineage) throw new Error("Private memory Session metadata is unavailable.");
      const meta = await client.getSession(lineage, false);
      if (!allowed() || sync.sessionId !== lineage || !meta) throw new Error("Private memory Session metadata is unavailable.");
      const lastCommitAt = meta.last_commit_at ? Date.parse(meta.last_commit_at) : Number.NaN;
      return { sessionId: request.sessionId, owner: "pi67-openviking", privacyMode: client.cfg.privacyMode,
        capturedTurns: meta.total_message_count ?? meta.message_count,
        pendingTokens: meta.pending_tokens ?? 0, liveTailTurns: client.cfg.takeoverKeepRecentTurns,
        takeoverActive: client.cfg.takeoverEnabled,
        ...(Number.isFinite(lastCommitAt) ? { lastCommitAt } : {}) };
    });
  });
  pi.on("session_shutdown", async () => { active = false; unsubscribe(); unsubscribeInspection(); });
}

function blocked(): Error {
  return new Error("Private memory Commit is unavailable: verify Session ownership, privacy mode and memory runtime.");
}
