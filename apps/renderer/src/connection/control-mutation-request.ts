import {
  createMessageId,
  type ReplaySafeControlMutationType
} from "@pi67/protocol";
import {
  requestWithBoundedTransportRetry,
  type TransportRetryPreparation
} from "./bounded-transport-retry.js";

export async function requestReplaySafeControlMutation<TResult>(
  type: ReplaySafeControlMutationType,
  execute: (idempotencyKey: string, attempt: number) => Promise<TResult>,
  prepareRetry?: TransportRetryPreparation
): Promise<TResult> {
  const idempotencyKey = createMessageId(`control-${type}`);
  return requestWithBoundedTransportRetry(
    (attempt) => execute(idempotencyKey, attempt),
    prepareRetry
  );
}
