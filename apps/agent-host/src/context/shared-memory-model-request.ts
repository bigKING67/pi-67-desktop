import type { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";

/** Host-owned per-request boundary. Scope/model are selected by the trusted
 * indexing owner, never adopted from an OpenViking response or saved lease.
 * The required signal must retire with identity, scope, policy or Host lifecycle.
 * Each retry must call this function again; no cached grant or provider fallback.
 * The native transport must enforce the same endpoint/model and honor signal.
 * This does not authorize replay of revoked assets or publication of an index.
 */
export async function runSharedMemoryModelRequest<T>(
  gateway: Pick<EnterpriseContextGatewayClient, "authorizeTeam" | "authorizeProject">,
  input: { userId: string; teamId: string; projectId: string | null;
    purpose: "extraction" | "embedding"; model: { baseUrl: string; id: string } },
  invoke: (model: Readonly<{ baseUrl: string; id: string }>, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  const scope = { ...input, model: Object.freeze({ ...input.model }) };
  signal.throwIfAborted();
  const grant = scope.projectId === null
    ? await gateway.authorizeTeam(scope.userId, scope.teamId, signal)
    : await gateway.authorizeProject(scope.userId, scope.teamId, scope.projectId, signal);
  signal.throwIfAborted();
  grant.assertModel(scope.purpose, scope.model);
  const remaining = Math.floor(grant.deadline - Date.now());
  if (remaining <= 0) throw new Error("Shared memory model authorization expired.");
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.min(remaining, 300_000))]);
  requestSignal.throwIfAborted();
  let cancel: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(requestSignal.reason);
    requestSignal.addEventListener("abort", cancel, { once: true });
  });
  try {
    // Observe even a non-cooperative late rejection without retaining this call.
    // Abort delivery is not proof that an external provider stopped processing.
    const result = await Promise.race([invoke(scope.model, requestSignal), cancelled]);
    requestSignal.throwIfAborted();
    grant.assertModel(scope.purpose, scope.model);
    return result;
  } finally { requestSignal.removeEventListener("abort", cancel); }
}
