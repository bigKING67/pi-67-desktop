import { ProtocolRequestError } from "@pi67/protocol";

const MAX_TRANSPORT_ATTEMPTS = 2;

export type TransportRetryPreparation = (
  error: ProtocolRequestError
) => boolean | Promise<boolean>;

export async function requestWithBoundedTransportRetry<TResult>(
  execute: (attempt: number) => Promise<TResult>,
  prepareRetry: TransportRetryPreparation = allowRetry
): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      return await execute(attempt);
    } catch (error) {
      lastError = error;
      if (
        attempt + 1 >= MAX_TRANSPORT_ATTEMPTS
        || !isRetryableTransportError(error)
        || !await prepareRetry(error)
      ) throw error;
    }
  }
  throw lastError;
}

function allowRetry(): boolean {
  return true;
}

function isRetryableTransportError(error: unknown): error is ProtocolRequestError {
  return error instanceof ProtocolRequestError
    && (error.code === "CONNECTION_CLOSED" || error.code === "STALE_HOST_EPOCH");
}
