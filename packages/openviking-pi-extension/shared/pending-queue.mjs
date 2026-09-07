// Scope-bound replay; filesystem recovery and mutations share the same immutable context.
import { isRetryableFailure as isRetryableReplayFailure } from "./retryable.mjs";
import { remoteOperationState } from "./pending-replay-policy.mjs";
import { listPending, dequeue, claimForReplay, releaseReplayClaim, incrementRetry, cleanStale, getMaxRetries, getReplayLimit } from "./pending-queue-storage.mjs";
export { enqueue, listPending, dequeue, claimForReplay, releaseReplayClaim, incrementRetry, cleanStale } from "./pending-queue-storage.mjs";

/**
 * Replay pending entries. Call this during session-start when the server is
 * healthy. Each run processes at most OPENVIKING_PENDING_REPLAY_LIMIT items so
 * a just-recovered server is not hit with an unbounded replay burst.
 *
 * @param {Function} fetchJSON - the configured fetchJSON from makeFetchJSON
 * @param {Function} log - logger function
 * @returns {{ replayed: number, failed: number, skipped: number, deferred: number, outcomes: Record<string, string> }}
 */
export async function replayPending(fetchJSON, log, canReplay = () => true, context) {
  const pending = await listPending(context);
  if (pending.length === 0) {
    return { replayed: 0, failed: 0, skipped: 0, deferred: 0, outcomes: {} };
  }
  const replayLimit = getReplayLimit();
  log("pending-queue", { count: pending.length, replayLimit, action: "replay-start" });
  let replayed = 0;
  let failed = 0;
  let skipped = 0;
  let deferred = 0;
  let processed = 0;
  const outcomes = {};
  for (const { filename, entry } of pending) {
    if (!canReplay() || processed >= replayLimit) {
      deferred++;
      outcomes[entry.dedupKey] = "deferred";
      continue;
    }
    if ((entry.retries || 0) >= getMaxRetries()) {
      await dequeue(filename, context);
      skipped++;
      outcomes[entry.dedupKey] = "skipped";
      continue;
    }
    const claimedFilename = await claimForReplay(filename, context);
    if (!claimedFilename) {
      deferred++;
      outcomes[entry.dedupKey] = "deferred";
      continue;
    }
    processed++;
    if (!canReplay()) {
      await releaseReplayClaim(claimedFilename, context);
      deferred++;
      outcomes[entry.dedupKey] = "deferred";
      continue;
    }
    let res;
    try {
      const encodedSid = encodeURIComponent(entry.sessionId);
      if (entry.type === "createSession" || entry.type === "addMessage") {
        const remote = await remoteOperationState(fetchJSON, entry);
        if (!canReplay() || !remote.known) {
          await releaseReplayClaim(claimedFilename, context);
          outcomes[entry.dedupKey] = "deferred";
          deferred += Math.max(1, pending.length - processed + 1);
          break;
        }
        if (remote.present) {
          await dequeue(claimedFilename, context);
          replayed++;
          outcomes[entry.dedupKey] = "replayed";
          continue;
        }
        res = entry.type === "createSession"
          ? await fetchJSON("/api/v1/sessions", {
              method: "POST",
              body: JSON.stringify(entry.payload),
            })
          : await fetchJSON(`/api/v1/sessions/${encodedSid}/messages`, {
              method: "POST",
              body: JSON.stringify(entry.payload),
            });
      } else if (entry.type === "commitSession") {
        res = await fetchJSON(`/api/v1/sessions/${encodedSid}/commit`, {
          method: "POST",
          body: JSON.stringify(entry.payload || {}),
        });
      } else {
        await dequeue(claimedFilename, context);
        skipped++;
        outcomes[entry.dedupKey] = "skipped";
        continue;
      }
    } catch {
      res = { ok: false };
    }
    if (!res?.ok && !canReplay()) {
      await releaseReplayClaim(claimedFilename, context);
      deferred++;
      outcomes[entry.dedupKey] = "deferred";
      continue;
    }
    if (entry.type === "commitSession") {
      log("pending-queue", {
        action: "commit-replay",
        sessionId: entry.sessionId,
        ok: Boolean(res?.ok),
        status: res?.result?.status || res?.status,
        trace_id: res?.traceId || res?.result?.trace_id,
        error: res?.ok ? undefined : res?.error?.message || res?.error?.code,
      });
    }
    if (res?.ok) {
      await dequeue(claimedFilename, context);
      replayed++;
      outcomes[entry.dedupKey] = "replayed";
    } else if (!isRetryableReplayFailure(res)) {
      await dequeue(claimedFilename, context);
      skipped++;
      outcomes[entry.dedupKey] = "skipped";
    } else {
      await incrementRetry(claimedFilename, entry, context);
      failed++;
      outcomes[entry.dedupKey] = "failed";
      if (entry.type === "addMessage") {
        deferred += Math.max(0, pending.length - processed);
        break;
      }
    }
  }
  const cleaned = canReplay() ? await cleanStale(context) : 0;
  log("pending-queue", {
    action: "replay-done",
    replayed,
    failed,
    skipped,
    deferred,
    cleaned,
  });
  return { replayed, failed, skipped, deferred, outcomes };
}
