import {
  ProtocolRequestError,
  type AgentCommandType
} from "./agent-messages.js";
import { requestCancellationEnvelope } from "./envelope.js";

export interface RequestAbortBinding {
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

interface CancellationPort {
  postMessage(message: unknown): void;
}

export function bindRequestAbort(
  signal: AbortSignal,
  onAbort: () => void
): RequestAbortBinding {
  signal.addEventListener("abort", onAbort, { once: true });
  return { signal, onAbort };
}

export function releaseRequestAbort(binding: RequestAbortBinding | undefined): void {
  if (binding) binding.signal.removeEventListener("abort", binding.onAbort);
}

export function postRequestCancellation(
  port: CancellationPort,
  requestId: string,
  hostEpoch: number,
  onFailure: () => void
): void {
  try {
    port.postMessage(requestCancellationEnvelope(requestId, hostEpoch));
  } catch {
    onFailure();
  }
}

export function requestCancelled(type: AgentCommandType): ProtocolRequestError {
  return new ProtocolRequestError({
    code: "CONNECTION_CLOSED",
    message: `Agent request was cancelled: ${type}`,
    recoverable: true
  });
}

export function waitForRequestConnection<T>(
  ready: Promise<T>,
  signal: AbortSignal | undefined,
  type: AgentCommandType
): Promise<T> {
  if (!signal) return ready;
  if (signal.aborted) return Promise.reject(requestCancelled(type));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(requestCancelled(type));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void ready.then(
      (identity) => {
        signal.removeEventListener("abort", onAbort);
        resolve(identity);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
