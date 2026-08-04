import {
  createMessageId,
  ProtocolRequestError,
  type ReplaySafeControlMutationType
} from "@pi67/protocol";
import {
  requestWithBoundedTransportRetry,
  isRetryableTransportError,
  type TransportRetryPreparation
} from "./bounded-transport-retry.js";

export async function requestReplaySafeControlMutation<TResult>(
  type: ReplaySafeControlMutationType,
  execute: (idempotencyKey: string, attempt: number) => Promise<TResult>,
  prepareRetry?: TransportRetryPreparation,
  onAcknowledgementDelayed?: () => void
): Promise<TResult> {
  const idempotencyKey = createMessageId(`control-${type}`);
  let acknowledgementDelayed = false;
  try {
    return await requestWithBoundedTransportRetry(
      async (attempt) => {
        if (attempt > 0 && acknowledgementDelayed) onAcknowledgementDelayed?.();
        return execute(idempotencyKey, attempt);
      },
      prepareRetry,
      (error): error is ProtocolRequestError => {
        acknowledgementDelayed = type === "session.create"
          && error instanceof ProtocolRequestError
          && error.code === "REQUEST_TIMEOUT";
        return isRetryableTransportError(error) || acknowledgementDelayed;
      }
    );
  } catch (error) {
    if (
      type === "session.create"
      && error instanceof ProtocolRequestError
      && error.code === "REQUEST_TIMEOUT"
    ) {
      throw new ProtocolRequestError({
        code: "REQUEST_OUTCOME_UNKNOWN",
        message: "Pi conversation creation has not been acknowledged yet.",
        recoverable: true
      });
    }
    throw error;
  }
}
