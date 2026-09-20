import type { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import type { SharedKnowledgeReceiptClient } from "./shared-knowledge-receipt-client.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";

interface SyncOptions {
  gateway: Pick<EnterpriseContextGatewayClient, "authorizeTeam" | "authorizeProject" | "syncKnowledge">;
  receipts: Pick<SharedKnowledgeReceiptClient, "request" | "signal">;
  userId: string;
  scope: { teamId: string; scopeKind: "team" | "project"; scopeId: string };
  /** Owner must fence account/service changes beyond the receipt client's lifetime. */
  assertCurrent: () => void;
  signal: AbortSignal;
  maxPages: number;
}

/** Bounded receipt-only catch-up. Not connected to production scheduling or indexing.
 * Main independently authorizes open/append; Host authorization cannot grant it access. */
export async function syncSharedKnowledge(options: SyncOptions) {
  const { gateway, receipts, userId, maxPages, assertCurrent } = options;
  const assertPower = enterprisePowerEpoch.capture();
  const signal = AbortSignal.any([options.signal, receipts.signal, enterprisePowerEpoch.signal]);
  const scope = { ...options.scope };
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error("Invalid shared sync page budget.");
  if (scope.scopeKind === "team" && scope.scopeId !== scope.teamId) throw new Error("Invalid shared sync team scope.");
  const check = () => { signal.throwIfAborted(); assertPower(); assertCurrent(); };
  check();
  const grant = scope.scopeKind === "team"
    ? await gateway.authorizeTeam(userId, scope.teamId, signal)
    : await gateway.authorizeProject(userId, scope.teamId, scope.scopeId, signal);
  const checkGrant = () => { check(); grant.assertValid(); };
  checkGrant();
  const opened = await receipts.request({ type: "shared-knowledge-receipt-open", scope }, signal);
  if (!opened.ok) throw new Error(`Shared sync open failed: ${opened.errorCode}.`);
  if (opened.type !== "shared-knowledge-receipt-open-result") throw new Error("Shared sync open operation mismatch.");
  const run = async () => {
    checkGrant();
    let progress = { ...opened.progress };
    for (let pages = 1; pages <= maxPages; pages++) {
      checkGrant();
      const response = await gateway.syncKnowledge({ ...scope, ...progress,
        permissionRevision: grant.permissionRevision, limit: 50 }, signal);
      checkGrant();
      // ignoreBOM preserves an initial BOM as a character so IPC re-encoding is exact.
      const pageJson = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(response.bytes);
      const saved = await receipts.request({ type: "shared-knowledge-receipt-append", handleId: opened.handleId,
        fromCursor: progress.cursor, epoch: progress.epoch, permissionRevision: grant.permissionRevision, pageJson }, signal);
      checkGrant();
      if (!saved.ok) throw new Error(`Shared sync append failed: ${saved.errorCode}.`);
      if (saved.type !== "shared-knowledge-receipt-append-result"
        || saved.progress.cursor !== response.page.nextCursor || saved.progress.epoch !== response.page.epoch) {
        throw new Error("Shared sync acknowledgement progress mismatch.");
      }
      progress = { ...saved.progress };
      if (!response.page.hasMore) return { progress, pages, headCursor: response.page.headCursor };
    }
    throw new Error("Shared sync page budget exhausted.");
  };
  const close = async () => {
    // Cleanup is independent of caller cancellation and bounded by the receipt client.
    // Preserve an original failure; Main generation invalidation owns orphan cleanup.
    const closed = await receipts.request({ type: "shared-knowledge-receipt-close", handleId: opened.handleId });
    if (!closed.ok || closed.type !== "shared-knowledge-receipt-close-result") throw new Error("Shared sync close failed.");
  };
  let result;
  try { result = await run(); }
  catch (error) { await close().catch(() => undefined); throw error; }
  await close();
  checkGrant();
  return result;
}
