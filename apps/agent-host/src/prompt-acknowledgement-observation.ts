import { AsyncLocalStorage } from "node:async_hooks";

type PromptAcknowledgementStage =
  | "received" | "dispatch-started" | "runtime-ready"
  | "receipt-reconcile-started" | "receipt-reconcile-completed"
  | "receipt-write-started" | "receipt-write-completed"
  | "response-ready" | "response-error-ready" | "response-posted" | "response-failed";

const observations = new AsyncLocalStorage<{ attempt: number; startedAt: number; closed: boolean; count: number }>();
const MAX_ATTEMPTS = 64;
let attempt = 0;

/** Test-only causal timing. No request identity, payload, error or path is captured. */
export function observePromptAcknowledgementRequest(type: string, dispatch: () => void): void {
  if (type !== "prompt.submit" || process.env.NODE_ENV !== "test"
    || process.env.PI67_TEST_CAPTURE_AGENT_INIT !== "1" || attempt >= MAX_ATTEMPTS) {
    dispatch();
    return;
  }
  observations.run({ attempt: ++attempt, startedAt: performance.now(), closed: false, count: 0 }, () => {
    observePromptAcknowledgement("received");
    dispatch();
  });
}

export function observePromptAcknowledgement(stage: PromptAcknowledgementStage): void {
  const observation = observations.getStore();
  if (!observation || observation.closed || observation.count >= 16) return;
  observation.count += 1;
  if (stage === "response-posted" || stage === "response-failed") observation.closed = true;
  try {
    process.stderr.write(`[agent-host:prompt-ack] ${JSON.stringify({
      attempt: observation.attempt,
      stage,
      elapsedMs: Math.max(0, Math.round(performance.now() - observation.startedAt))
    })}\n`);
  } catch {
    // Optional test diagnostics must never change admission or delivery behavior.
  }
}
