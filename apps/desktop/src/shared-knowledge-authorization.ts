import type { EnterpriseCredentialBrokerPort } from "./enterprise-credential-supervisor.js";
import type { SharedKnowledgeReceiptOwner } from "./shared-knowledge-receipt-binding.js";

type Scope = Pick<SharedKnowledgeReceiptOwner, "teamId" | "scopeKind" | "scopeId">;
type Identity = Pick<SharedKnowledgeReceiptOwner, "userId" | "endpoint">;
const denied = () => new Error("Shared knowledge authorization unavailable.");

/** Main's narrow read-only HTTPS exception. No refresh, redirects, model policy
 * grant, content transport or fallback. The broker owns the eight-second timeout. */
export async function authorizeSharedKnowledge(store: EnterpriseCredentialBrokerPort, scope: Scope, identity: Identity, signal: AbortSignal) {
  const expected = { ...scope, ...identity };
  signal.throwIfAborted();
  const snapshot = await store.load();
  signal.throwIfAborted();
  const credential = snapshot.credential;
  if (snapshot.storage !== "available" || !credential || credential.userId !== expected.userId
    || credential.endpoint !== expected.endpoint || credential.expiresAt <= Date.now()) throw denied();
  const endpoint = new URL(credential.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || /[\s\\?#]/u.test(credential.endpoint)) throw denied();
  const base = `${endpoint.href.replace(/\/+$/u, "")}/v1/agent/teams/${encodeURIComponent(expected.teamId)}`;
  const route = expected.scopeKind === "team" ? `${base}/authorization`
    : `${base}/projects/${encodeURIComponent(expected.scopeId)}/authorization`;
  const startedAt = Date.now(), startedMonotonic = performance.now();
  let value: unknown;
  try {
    const response = await fetch(route, { method: "GET", redirect: "error", cache: "no-store", signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${credential.accessToken}` } });
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    value = await readAuthorization(response, signal);
  } catch { throw denied(); }
  signal.throwIfAborted();
  return receiptGrant(value, expected, startedAt, startedMonotonic, credential.expiresAt);
}

async function readAuthorization(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" || !response.body) {
    void response.body?.cancel().catch(() => undefined); throw denied();
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const bytes = new Uint8Array(128 * 1024);
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read(); signal.throwIfAborted();
      if (chunk.done) break;
      if (chunk.value.byteLength > bytes.length - size) throw denied();
      bytes.set(chunk.value, size); size += chunk.value.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
  } catch (error) { abort(); throw error; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

function receiptGrant(value: unknown, expected: Scope & Identity, startedAt: number, startedMonotonic: number, credentialExpiry: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw denied();
  const item = value as Record<string, unknown>;
  if (item.userId !== expected.userId || item.teamId !== expected.teamId
    || (expected.scopeKind === "team" ? Object.hasOwn(item, "projectId") || expected.scopeId !== expected.teamId : item.projectId !== expected.scopeId)
    || !["owner", "admin", "member", "viewer"].includes(String(item.role))
    || typeof item.permissionRevision !== "string" || !/^[a-f0-9]{64}$/u.test(item.permissionRevision)) throw denied();
  const timestamp = (input: unknown) => {
    if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(input)) throw denied();
    const result = Date.parse(input); if (!Number.isFinite(result)) throw denied(); return result;
  };
  const issued = timestamp(item.issuedAt), expires = timestamp(item.leaseExpiresAt);
  const duration = expires - issued, now = Date.now(), mono = performance.now();
  if (duration <= 0 || duration > 300_000 || issued > now + 30_000 || now < startedAt || mono < startedMonotonic) throw denied();
  const deadline = Math.min(expires, startedAt + duration, credentialExpiry);
  const monotonicDeadline = Math.min(startedMonotonic + duration, mono + deadline - now);
  let retired = false, lastWallTime = now;
  const assertValid = () => {
    const wallTime = Date.now();
    retired ||= wallTime < lastWallTime || wallTime >= deadline || performance.now() >= monotonicDeadline;
    lastWallTime = wallTime;
    if (retired) throw denied();
  };
  assertValid();
  // modelPolicy is deliberately not consumed: this is a receipt-only grant.
  return { permissionRevision: item.permissionRevision, assertValid };
}
