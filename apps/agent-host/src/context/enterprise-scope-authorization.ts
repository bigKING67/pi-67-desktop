import { asRecord, boundedString, invalidResponse, lowercaseSha256, parseTimestamp } from "./enterprise-context-gateway-validation.js";

export function parseScopeAuthorization(value: unknown, expected: { userId: string; teamId: string; projectId: string | null }, startedAt: number, startedMonotonic?: number) {
  const item = asRecord(value), now = Date.now(), monotonicNow = performance.now();
  const monotonicStart = startedMonotonic ?? monotonicNow - (now - startedAt);
  if (!Number.isFinite(startedAt) || startedAt > now || !Number.isFinite(monotonicStart)
    || monotonicStart > monotonicNow) throw invalidResponse("authorization.clock");
  // Server team authorization omits projectId; null is the caller's explicit
  // team-scope expectation, not permission to accept a project grant.
  const matchesProject = expected.projectId === null ? !Object.hasOwn(item, "projectId") : item.projectId === expected.projectId;
  if (item.userId !== expected.userId || item.teamId !== expected.teamId || !matchesProject
    || !["owner", "admin", "member", "viewer"].includes(String(item.role))) throw invalidResponse("authorization.scope");
  const issuedAt = parseTimestamp(item.issuedAt, "authorization.issuedAt");
  const expiresAt = parseTimestamp(item.leaseExpiresAt, "authorization.leaseExpiresAt");
  const duration = expiresAt - issuedAt;
  if (duration <= 0 || duration > 300_000 || issuedAt > now + 30_000) throw invalidResponse("authorization.lease");
  const deadline = Math.min(expiresAt, startedAt + duration);
  const monotonicDeadline = Math.min(monotonicStart + duration, monotonicNow + deadline - now);
  const policy = asRecord(item.modelPolicy);
  if (policy.teamId !== expected.teamId || typeof policy.revision !== "string"
    || !/^(0|[1-9][0-9]{0,18})$/u.test(policy.revision) || BigInt(policy.revision) > 9223372036854775807n
    || !Array.isArray(policy.allowedModels) || policy.allowedModels.length > 32) throw invalidResponse("authorization.modelPolicy");
  const rules = new Set<string>();
  for (const candidate of policy.allowedModels) {
    const rule = asRecord(candidate);
    if (!["agent", "extraction", "embedding"].includes(String(rule.purpose))) throw invalidResponse("authorization.modelPurpose");
    const endpoint = boundedString(rule.endpoint, "authorization.endpoint", 2048);
    const model = boundedString(rule.modelId, "authorization.modelId", 128);
    let url: URL;
    try { url = new URL(endpoint); } catch { throw invalidResponse("authorization.endpoint"); }
    if (!(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      || url.username || url.password || url.search || url.hash || /\s|\p{Cc}/u.test(model)) throw invalidResponse("authorization.modelRule");
    const identity = JSON.stringify([rule.purpose, url.href, model]);
    if (rules.has(identity)) throw invalidResponse("authorization.duplicateRule");
    rules.add(identity);
  }
  const permissionRevision = lowercaseSha256(item.permissionRevision, "authorization.permissionRevision");
  let invalidated = false, lastWallTime = now;
  const assertValid = () => {
    const wallTime = Date.now();
    invalidated ||= wallTime < lastWallTime || wallTime >= deadline || performance.now() >= monotonicDeadline;
    lastWallTime = wallTime;
    if (invalidated) throw invalidResponse("authorization.expired");
  };
  assertValid();
  const assertModel = (purpose: "agent" | "extraction" | "embedding", model: { baseUrl: string; id: string } | null) => {
    assertValid();
    let endpoint: string;
    try { endpoint = model ? new URL(model.baseUrl).href : ""; } catch { endpoint = ""; }
    if (!model || !rules.has(JSON.stringify([purpose, endpoint, model.id]))) {
      throw new Error("The current model is not authorized to process this team's shared content.");
    }
  };
  const assertAgentModel = (model: { baseUrl: string; id: string } | null) => assertModel("agent", model);
  return { permissionRevision, deadline, assertValid, assertModel, assertAgentModel };
}
