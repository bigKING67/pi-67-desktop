type ShutdownPhase =
  | "host-operations" | "host-task-runtimes" | "host-compatibility-runtime"
  | "host-writer-leases" | "host-requests" | "host-workspaces"
  | "host-credentials" | "host-attachments"
  | "runtime-subagents" | "runtime-configuration" | "runtime-session" | "runtime-catalog";

let nextSequence = 0;

/** Isolated test capture only; a started phase alone never certifies completion. */
export async function observeShutdownPhase<T>(phase: ShutdownPhase, operation: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== "test" || process.env.PI67_TEST_CAPTURE_SHUTDOWN !== "1"
    || nextSequence >= 64) return operation();
  const sequence = ++nextSequence;
  const startedAt = performance.now();
  const emit = (outcome: "started" | "completed" | "failed"): void => {
    try {
      process.stderr.write(`[agent-host:shutdown] ${JSON.stringify({ sequence, stage: phase, outcome,
        durationMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - startedAt))) })}\n`);
    } catch {
      // Observability must not change shutdown completion or its original error.
    }
  };
  emit("started");
  try {
    const result = await operation();
    emit("completed");
    return result;
  } catch (error) {
    emit("failed");
    throw error;
  }
}
