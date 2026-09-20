import { homedir } from "node:os";
import { join } from "node:path";
import { enqueue, listPending, replayPending, type PendingQueueContext } from "./shared/pending-queue.mjs";

/** Captures the directory once; concurrent Sessions never change process environment to select a queue. */
export function createScopedPendingQueue(scopeKey: string) {
  if (!/^[a-f0-9]{64}$/u.test(scopeKey)) throw new Error("A bounded Memory scope identity is required.");
  const root = process.env.OPENVIKING_PENDING_DIR || join(homedir(), ".openviking", "pending");
  const context: PendingQueueContext = Object.freeze({ directory: join(root, "scoped-v1", scopeKey), scopeKey });
  const forSession = (sessionId: string): PendingQueueContext => {
    if (!sessionId) throw new Error("An exact Memory Session is required for replay.");
    return Object.freeze({ ...context, sessionId });
  };
  return Object.freeze({
    scopeKey,
    enqueue: (type: string, sessionId: string, payload: Record<string, any>) => enqueue(type, sessionId, payload, {}, context),
    listPending: (sessionId?: string) => listPending(sessionId === undefined ? context : forSession(sessionId)),
    replayPending: (fetchJSON: Parameters<typeof replayPending>[0], log: Parameters<typeof replayPending>[1], canReplay: () => boolean, sessionId: string) =>
      replayPending(fetchJSON, log, canReplay, forSession(sessionId))
  });
}
