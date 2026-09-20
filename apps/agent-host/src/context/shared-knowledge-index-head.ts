import type { SharedKnowledgeIndexSnapshot, SharedKnowledgeReceiptRequest } from "@pi67/protocol";
import type { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";

type Prepare = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-index-prepare" }>;
type Scope = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-receipt-open" }>["scope"];
type Stage = "authorization" | "head-probe" | "validation";
type Outcome = "completed" | "authorization-failed" | "head-probe-failed" | "validation-failed" | "revision-changed" | "timeout" | "cancelled";
interface HeadDiagnostic { schema: "new-money.team-head.v1"; outcome: Outcome; durationMs: number;
  stages: Array<{ stage: Stage; durationMs: number }> }
// Host stdout is intentionally discarded. Use its existing opt-in stderr
// diagnostic channel; Main still redacts and bounds forwarded lines.
const reportHead = (value: HeadDiagnostic) => { console.error("[team-head]", JSON.stringify(value)); };

/** Post-index observation, not a publication grant or lock on the remote stream.
 * Read at the exact Main-verified cursor under fresh scope/model authorization.
 * Never append this probe, renew receipts, sync/rebuild or invoke a model here. */
export async function verifySharedKnowledgeIndexHead(
  gateway: Pick<EnterpriseContextGatewayClient, "authorizeTeam" | "authorizeProject" | "syncKnowledge">,
  input: { userId: string; scope: Scope; models: Prepare["models"]; snapshot: SharedKnowledgeIndexSnapshot },
  signal: AbortSignal
): Promise<() => void> {
  return (await observeSharedKnowledgeIndexHead(gateway, input, signal)).assertValid;
}

export async function observeSharedKnowledgeIndexHead(
  gateway: Pick<EnterpriseContextGatewayClient, "authorizeTeam" | "authorizeProject" | "syncKnowledge">,
  input: { userId: string; scope: Scope; models: Prepare["models"]; snapshot: SharedKnowledgeIndexSnapshot; permissionRevision?: string },
  signal: AbortSignal,
  report: (value: HeadDiagnostic) => void = reportHead
) {
  const scope = { ...input.scope }, snapshot = { ...input.snapshot }, userId = input.userId;
  const permissionRevision = input.permissionRevision;
  const embedding = { baseUrl: input.models.embedding.endpoint, id: input.models.embedding.model };
  const extraction = { baseUrl: input.models.extraction.endpoint, id: input.models.extraction.model };
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  const startedTrace = performance.now();
  let stage: Stage = "authorization", stageStart = startedTrace, outcome: Outcome = "authorization-failed";
  const stages: HeadDiagnostic["stages"] = [];
  const advance = (next: Stage) => {
    stages.push({ stage, durationMs: Math.max(0, Math.round(performance.now() - stageStart)) });
    stage = next; stageStart = performance.now();
  };
  try {
    requestSignal.throwIfAborted();
    const grant = scope.scopeKind === "team"
      ? await gateway.authorizeTeam(userId, scope.teamId, requestSignal)
      : await gateway.authorizeProject(userId, scope.teamId, scope.scopeId, requestSignal);
    if (permissionRevision !== undefined && grant.permissionRevision !== permissionRevision) { outcome = "revision-changed"; throw new Error(); }
    const assertModels = () => { grant.assertModel("embedding", embedding); grant.assertModel("extraction", extraction); };
    requestSignal.throwIfAborted(); assertModels();
    advance("head-probe"); outcome = "head-probe-failed";
    const started = Date.now(), monotonicStart = performance.now();
    const { page } = await gateway.syncKnowledge({ ...scope, ...snapshot, permissionRevision: grant.permissionRevision, limit: 1 }, requestSignal);
    requestSignal.throwIfAborted(); assertModels();
    advance("validation"); outcome = "validation-failed";
    if (page.epoch !== snapshot.epoch || page.nextCursor !== snapshot.cursor || page.headCursor !== snapshot.cursor
      || page.hasMore || page.changes.length) { outcome = "revision-changed"; throw new Error(); }
    const expires = page.leaseExpiresAt, issued = page.issuedAt;
    const deadline = Math.min(expires, started + expires - issued), monotonicDeadline = monotonicStart + deadline - started;
    // The decoder validates lease shape. The observation also needs a current
    // receipt-time bound; a future server timestamp cannot extend its lifetime.
    const assertValid = () => {
      assertModels();
      if (!Number.isFinite(deadline) || issued > Date.now() + 30_000 || Date.now() >= deadline || performance.now() >= monotonicDeadline) {
        throw new Error("Shared knowledge index observation expired.");
      }
    };
    assertValid();
    outcome = "completed";
    // Caller independently checks its lifetime after cleanup. The request-only
    // cancellation deadline must not invalidate a completed observation early.
    return Object.freeze({ validUntil: Math.min(deadline, grant.deadline), assertValid });
  } catch {
    if (requestSignal.aborted) outcome = requestSignal.reason instanceof Error && requestSignal.reason.name === "TimeoutError" ? "timeout" : "cancelled";
    throw new Error("Shared knowledge index is not current or authorized.");
  } finally {
    stages.push({ stage, durationMs: Math.max(0, Math.round(performance.now() - stageStart)) });
    try { report({ schema: "new-money.team-head.v1", outcome, durationMs: Math.max(0, Math.round(performance.now() - startedTrace)), stages }); }
    catch { /* Diagnostics never change authorization or cleanup. */ }
  }
}
