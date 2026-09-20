import { createHash } from "node:crypto";
import { decodeKnowledgeSyncPage, type KnowledgeSyncExpectation } from "@pi67/protocol";
import type { SharedKnowledgeReceiptStore } from "./shared-knowledge-receipt-store.js";

type ProjectionScope = Pick<KnowledgeSyncExpectation, "teamId" | "scopeKind" | "scopeId">;
export interface SharedKnowledgeStagedVersion {
  readonly assetId: string;
  readonly contentRevision: string;
  readonly cursor: string;
  readonly operation: "upsert" | "revoke";
}
interface ProjectionSnapshot {
  readonly scope: Readonly<ProjectionScope>;
  readonly epoch: string | null;
  readonly cursor: string;
  readonly capturedHeadCursor: string;
  readonly receiptRecord: string | null;
  readonly pages: number;
  readonly versions: readonly SharedKnowledgeStagedVersion[];
}

/** A bounded, unpublished rebuild manifest, NOT an index or access grant.
 * The caller owns the store's local-profile/service/user namespace. Scope input
 * must come from that trusted binding, not from a saved page or search result.
 * Retain tombstones; indexing must not resurrect an older version after revoke.
 * No bodies, model calls, credentials, lease renewal or active-index swap here.
 * Before publication a future index owner must separately check live permission,
 * model policy, current stream head and completed indexing against this snapshot.
 */
export async function stageSharedKnowledgeProjection(
  store: SharedKnowledgeReceiptStore,
  scope: ProjectionScope,
  limits: { maxPages: number; maxAssets: number },
  signal?: AbortSignal
): Promise<Readonly<ProjectionSnapshot>> {
  if (!Number.isSafeInteger(limits.maxAssets) || limits.maxAssets < 1 || limits.maxAssets > 100_000) {
    throw new Error("Invalid shared projection asset budget.");
  }
  const binding = Object.freeze({ ...scope });
  const maxAssets = limits.maxAssets;
  const versions = new Map<string, SharedKnowledgeStagedVersion>();
  let epoch: string | null = null;
  let cursor = "0";
  let capturedHeadCursor = "0";
  const replay = await store.replayHistory(limits.maxPages, async (receipt) => {
    signal?.throwIfAborted();
    const page = decodeHistoricalPage(receipt.bytes, { ...binding, epoch, cursor });
    if (page.epoch !== receipt.epoch || receipt.fromCursor !== cursor || page.nextCursor !== receipt.toCursor
        || BigInt(page.headCursor) < BigInt(capturedHeadCursor)) {
      throw new Error("Shared projection receipt metadata mismatch.");
    }
    for (const change of page.changes) {
      if (!versions.has(change.assetId) && versions.size >= maxAssets) throw new Error("Shared projection asset budget exceeded.");
      versions.set(change.assetId, Object.freeze({ assetId: change.assetId, contentRevision: change.contentRevision,
        cursor: change.cursor, operation: change.operation }));
    }
    epoch = page.epoch;
    cursor = page.nextCursor;
    capturedHeadCursor = page.headCursor;
  }, signal);
  signal?.throwIfAborted();
  // Partial staging is never returned if decoding, traversal, budgets or abort fail.
  return Object.freeze({ scope: binding, epoch, cursor, capturedHeadCursor,
    receiptRecord: replay.pointer?.record ?? null, pages: replay.pages,
    versions: Object.freeze([...versions.values()]) });
}

/** Replays latest active bodies into Main-owned unpublished staging or the
 * separately authorized published reader's withheld, exact-version result.
 * No historical superseded/revoked body reaches the sink. The sink must honor
 * cancellation, discard all partial output on rejection, and never invoke a
 * model or expose content merely because this storage operation succeeded.
 * A successful return covers a captured local snapshot, not a live server head,
 * a permission lease, index completion or an atomic publication right.
 */
export async function materializeSharedKnowledgeProjection(
  store: SharedKnowledgeReceiptStore,
  scope: ProjectionScope,
  limits: { maxPages: number; maxAssets: number },
  stage: (version: SharedKnowledgeStagedVersion, canonicalContent: string, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal
) {
  const budget = { ...limits };
  const manifest = await stageSharedKnowledgeProjection(store, scope, budget, signal);
  const active = new Map(manifest.versions.filter((version) => version.operation === "upsert").map((version) => [version.assetId, version]));
  const assertSnapshot = async () => {
    signal?.throwIfAborted();
    const current = await store.read();
    signal?.throwIfAborted();
    if ((current?.record ?? null) !== manifest.receiptRecord) throw new Error("Shared projection snapshot changed.");
  };
  await assertSnapshot();
  const replay = await store.replayHistory(budget.maxPages, async (receipt) => {
    await assertSnapshot();
    const page = decodeHistoricalPage(receipt.bytes, { ...manifest.scope, epoch: manifest.epoch, cursor: receipt.fromCursor });
    for (const change of page.changes) {
      const version = active.get(change.assetId);
      if (!version || version.cursor !== change.cursor) continue;
      if (change.operation !== "upsert" || change.canonicalContent === undefined || change.contentRevision !== version.contentRevision) {
        throw new Error("Shared projection version mismatch.");
      }
      await assertSnapshot();
      await stage(version, change.canonicalContent, signal);
      await assertSnapshot();
      active.delete(change.assetId);
    }
  }, signal);
  await assertSnapshot();
  if ((replay.pointer?.record ?? null) !== manifest.receiptRecord || active.size !== 0) {
    throw new Error("Shared projection replay is incomplete.");
  }
  return manifest;
}

function decodeHistoricalPage(bytes: Uint8Array, expected: Omit<KnowledgeSyncExpectation, "permissionRevision" | "limit">) {
  // Historical revisions may differ. This verifies format, never current access.
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!raw || typeof raw !== "object" || !("permissionRevision" in raw) || typeof raw.permissionRevision !== "string") {
    throw new Error("Invalid historical shared permission revision.");
  }
  return decodeKnowledgeSyncPage(bytes, { ...expected, permissionRevision: raw.permissionRevision, limit: 100 },
    (text) => createHash("sha256").update(text, "utf8").digest("hex"));
}
