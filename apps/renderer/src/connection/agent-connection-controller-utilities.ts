import { ProtocolRequestError, type AgentConnectionIdentity } from "@pi67/protocol";

export async function prepareSameHostTransportRetry(
  expectedHostEpoch: number | undefined,
  waitForConnection: () => Promise<AgentConnectionIdentity>
): Promise<boolean> {
  if (expectedHostEpoch === undefined) return false;
  const identity = await waitForConnection();
  return identity.hostEpoch === expectedHostEpoch;
}

export function connectionError(message: string): ProtocolRequestError {
  return new ProtocolRequestError({ code: "CONNECTION_CLOSED", message, recoverable: true });
}

export function disposedError(): ProtocolRequestError {
  return connectionError("Agent connection controller has been disposed.");
}

export function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return resolved;
}
