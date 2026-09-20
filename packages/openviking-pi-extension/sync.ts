import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildCommitRequestBody, type OVClient, type OVCommitResult } from "./client.js";
import type { OVConfig } from "./config.js";
import { extractBranchCapturePayloads } from "./lib/capture-adapter.mjs";
import { countUndeliveredForSession, estimatePayloadTokens } from "./lib/takeover-core.mjs";
import { createScopedPendingQueue } from "./scoped-pending-queue.js";
import { deriveHarnessSessionId } from "./shared/session-model.mjs";

export const SYNC_STATE_ENTRY_TYPE = "ov-sync-state-v2";

export interface AddPayloadResult {
  accepted: boolean;
  delivered: boolean;
}

export interface SyncBranchResult {
  added: number;
  tokens: number;
  allDelivered: boolean;
  lineageChanged: boolean;
  blockedReason?: "memory-scope-unverified";
}

type ScopedQueue = ReturnType<typeof createScopedPendingQueue>;
type ReplayResult = Awaited<ReturnType<ScopedQueue["replayPending"]>>;

interface SyncStateData {
  version: 2;
  scopeKey: string;
  piSessionId: string;
  ovSessionId: string;
  lineage: number;
  syncedCaptureCount: number;
  prefixHash: string;
}

interface SyncManagerOptions {
  persistEntry?: (customType: string, data: SyncStateData) => void;
}

function debugLog(message: string): void {
  const file = process.env.OV_DEBUG_LOG;
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Best effort; logging must never affect Pi.
  }
}

export class SyncManager {
  private ovSessionId: string | null = null;
  private sourcePiSessionId: string | null = null;
  private syncedCaptureCount = 0;
  private prefixHash = "";
  private lineage = 0;
  private persistEntry?: SyncManagerOptions["persistEntry"];
  private queue: ScopedQueue | null = null;
  private scopeUnverified = false;
  private scopeAnchored = false;
  private committing = false;

  constructor(
    private client: OVClient,
    private config: OVConfig,
    options: SyncManagerOptions = {},
  ) {
    this.persistEntry = options.persistEntry;
  }

  get sessionId(): string | null { return this.ovSessionId; }
  get piSessionId(): string | null { return this.sourcePiSessionId; }
  get syncedCount(): number { return this.syncedCaptureCount; }

  get blockedReason(): "memory-scope-unverified" | undefined {
    return this.scopeUnverified || !this.queue || this.queue.scopeKey !== this.client.memoryScopeKey
      ? "memory-scope-unverified" : undefined;
  }

  private canWrite(): boolean {
    return !this.blockedReason && this.config.enabled && this.config.privateWriteEnabled;
  }

  restore(branch: any[], piSessionId: string, legacyWatermark = 0, sessionEntries = branch): void {
    // Scan the complete Pi history, not only the active branch: compaction or
    // branch navigation must not reopen private capture after shared knowledge.
    if (sessionEntries.some(hasSharedKnowledgeCall) || hasUnverifiedMemoryProvenance(sessionEntries, piSessionId)) this.scopeUnverified = true;
    const scopeKey = this.client.memoryScopeKey;
    if (this.queue && this.queue.scopeKey !== scopeKey) { this.scopeUnverified = true; return; }
    this.queue ??= createScopedPendingQueue(scopeKey);
    this.sourcePiSessionId = piSessionId;
    const base = deriveHarnessSessionId("pi-", piSessionId);
    const latest = findLatestSyncState(branch);
    const restored = validSyncState(latest, piSessionId, base, scopeKey) ? latest : null;
    // Pi context can survive without a normal message entry (compaction, branch
    // summaries and Extension messages). Such history is not a fresh private
    // session and must never acquire ownership merely because messages vanished.
    const hasContextHistory = branch.some((entry) =>
      ["message", "compaction", "branch_summary", "custom_message"].includes(entry?.type));
    if (!restored && (latest !== undefined || legacyWatermark > 0 || hasContextHistory)) {
      this.scopeUnverified = true;
      this.ovSessionId = null;
      return;
    }
    if (restored) {
      this.scopeAnchored = true;
      this.ovSessionId = restored.ovSessionId;
      this.lineage = restored.lineage;
      this.syncedCaptureCount = restored.syncedCaptureCount;
      this.prefixHash = restored.prefixHash;
      return;
    }

    this.lineage = 0;
    this.ovSessionId = this.lineageSessionId(base);
    this.syncedCaptureCount = 0;
    this.prefixHash = "";
  }

  anchorScope(): boolean {
    if (!this.canWrite()) return false;
    if (this.scopeAnchored) return true;
    if (!this.persistState()) { this.scopeUnverified = true; return false; }
    this.scopeAnchored = true;
    return true;
  }

  observeSharedToolCall(toolName: string): void {
    // The attempt is enough. Block before execution so parallel remember/replay
    // cannot race the shared result; a failed Tool does not reopen authority.
    if (SHARED_KNOWLEDGE_TOOLS.has(toolName)) this.scopeUnverified = true;
  }

  async ensureSession(piSessionId: string): Promise<boolean> {
    if (!this.canWrite() || !this.queue) return false;
    if (!this.sourcePiSessionId) this.sourcePiSessionId = piSessionId;
    if (this.sourcePiSessionId !== piSessionId) return false;
    this.ovSessionId ??= deriveHarnessSessionId("pi-", piSessionId);
    if (!this.anchorScope()) return false;
    const queued = await this.queue.enqueue("createSession", this.ovSessionId, {
      session_id: this.ovSessionId,
      auto_commit_policy: null,
    });
    if (!queued.ok) return false;
    if (!this.client.connected) return false;
    const replay = await this.replayPending();
    return replay.outcomes[queued.dedupKey] === "replayed";
  }

  async replayPending(): Promise<ReplayResult> {
    const sessionId = this.ovSessionId;
    if (!sessionId || !this.scopeAnchored || !this.client.connected || !this.canWrite() || !this.queue) return emptyReplayResult();
    return this.queue.replayPending(
      (path: string, init?: any) => init?.method === "POST"
        ? this.client.writeJSON(path, init, 10000)
        : this.client.fetchJSON(path, init, 10000),
      (stage: string, data: unknown) => debugLog(`${stage}: ${JSON.stringify(data)}`),
      () => this.canWrite() && this.ovSessionId === sessionId,
      sessionId,
    );
  }

  async flushForTakeover(): Promise<boolean> {
    if (!this.ovSessionId || !this.canWrite() || !this.queue) return false;
    await this.replayPending();
    if (!this.canWrite()) return false;
    const pending = await this.queue.listPending(this.ovSessionId);
    return countUndeliveredForSession(pending, this.ovSessionId) === 0;
  }

  async syncBranch(branch: any[]): Promise<SyncBranchResult> {
    if (branch.some(hasSharedKnowledgeCall) || hasUnverifiedMemoryProvenance(branch, this.sourcePiSessionId)) this.scopeUnverified = true;
    if (this.blockedReason) return { added: 0, tokens: 0, allDelivered: false, lineageChanged: false, blockedReason: this.blockedReason };
    if (!this.ovSessionId || !this.sourcePiSessionId) {
      return { added: 0, tokens: 0, allDelivered: true, lineageChanged: false };
    }

    const lineageChanged = await this.alignBranch(branch);
    const extracted = extractBranchCapturePayloads(
      branch,
      this.syncedCaptureCount,
      this.config,
      this.prefixHash,
    );

    let added = 0;
    let tokens = 0;
    let allDelivered = true;
    for (let index = 0; index < extracted.payloads.length; index++) {
      const payload = extracted.payloads[index];
      const result = await this.addPayload(payload);
      if (!result.accepted) {
        allDelivered = false;
        break;
      }
      const nextCount = this.syncedCaptureCount + 1;
      const nextPrefixHash = extracted.prefixHashes[index] ?? this.prefixHash;
      if (!this.persistState(nextCount, nextPrefixHash)) {
        allDelivered = false;
        break;
      }
      this.syncedCaptureCount = nextCount;
      this.prefixHash = nextPrefixHash;
      added++;
      tokens += estimatePayloadTokens(payload);
      allDelivered = allDelivered && result.delivered;
    }
    if (added > 0 && !this.config.takeoverEnabled) await this.commitIfNeeded();
    return { added, tokens, allDelivered, lineageChanged, ...(this.blockedReason ? { blockedReason: this.blockedReason } : {}) };
  }

  async alignBranch(branch: any[]): Promise<boolean> {
    if (!this.ovSessionId || !this.sourcePiSessionId || !this.canWrite()) return false;
    const extracted = extractBranchCapturePayloads(
      branch,
      this.syncedCaptureCount,
      this.config,
      this.prefixHash,
    );
    if (!extracted.resetWatermark) return false;
    this.lineage++;
    this.ovSessionId = this.lineageSessionId(deriveHarnessSessionId("pi-", this.sourcePiSessionId));
    this.syncedCaptureCount = 0;
    this.prefixHash = "";
    await this.ensureSession(this.sourcePiSessionId);
    this.persistState();
    return true;
  }

  async addPayload(payload: any): Promise<AddPayloadResult> {
    if (!this.ovSessionId || !this.canWrite() || !this.queue || !this.scopeAnchored) return { accepted: false, delivered: false };
    const queued = await this.queue.enqueue("addMessage", this.ovSessionId, payload);
    if (!queued.ok) return { accepted: false, delivered: false };
    const replay = this.client.connected ? await this.replayPending() : emptyReplayResult();
    const outcome = replay.outcomes[queued.dedupKey];
    return {
      accepted: outcome !== "skipped",
      delivered: outcome === "replayed",
    };
  }

  async commitIfNeeded(): Promise<void> {
    if (!this.ovSessionId || !this.canWrite()) return;
    const meta = await this.client.getSession(this.ovSessionId);
    if (Number(meta?.pending_tokens || 0) >= this.config.commitTokenThreshold) await this.commit();
  }

  async commit(opts: { queueOnFailure?: boolean; keepRecentCount?: number; keepRecentTurns?: number } = {}): Promise<OVCommitResult | null> {
    if (this.committing || !this.ovSessionId || !this.canWrite() || !this.queue || !this.scopeAnchored) return null;
    const sessionId = this.ovSessionId;
    this.committing = true;
    try {
      const retention = opts.keepRecentTurns === undefined
        ? (opts.keepRecentCount ?? this.config.commitKeepRecentCount)
        : { keepRecentTurns: opts.keepRecentTurns };
      const response = await this.client.commitSessionResponse(sessionId, retention);
      const result = response.result;
      if (!result) {
        debugLog(`commit: session=${sessionId} ok=false status=${response.status ?? 0} trace_id=${response.traceId || "none"} error=${response.error?.message || response.error?.code || "unknown"}`);
        if (opts.queueOnFailure !== false && this.canWrite() && this.ovSessionId === sessionId) {
          await this.queue.enqueue("commitSession", sessionId, buildCommitRequestBody(retention));
        }
        return null;
      }
      debugLog(`commit: session=${sessionId} ok=true status=${result.status || "unknown"} archived=${result.archived === true} trace_id=${result.trace_id || "none"}`);
      return result;
    } finally {
      this.committing = false;
    }
  }

  async shutdown(): Promise<void> {
    return;
  }

  private lineageSessionId(base: string): string {
    return this.lineage > 0 ? `${base}__lineage-${this.lineage}` : base;
  }

  private persistState(
    syncedCaptureCount = this.syncedCaptureCount,
    prefixHash = this.prefixHash,
  ): boolean {
    if (!this.persistEntry || !this.ovSessionId || !this.sourcePiSessionId || this.blockedReason || !this.queue) return false;
    try {
      this.persistEntry(SYNC_STATE_ENTRY_TYPE, {
        version: 2,
        scopeKey: this.queue.scopeKey,
        piSessionId: this.sourcePiSessionId,
        ovSessionId: this.ovSessionId,
        lineage: this.lineage,
        syncedCaptureCount,
        prefixHash,
      });
      return true;
    } catch {
      return false;
    }
  }
}

function emptyReplayResult(): ReplayResult {
  return { replayed: 0, failed: 0, skipped: 0, deferred: 0, outcomes: {} };
}

const SHARED_KNOWLEDGE_TOOLS = new Set([
  "viking_shared_search", "viking_shared_read", "viking_sop_search", "viking_sop_read"
]);

function hasSharedKnowledgeCall(entry: any): boolean {
  if (entry?.type !== "message") return false;
  const message = entry.message;
  if (message?.role === "toolResult") return SHARED_KNOWLEDGE_TOOLS.has(message.toolName);
  return message?.role === "assistant" && Array.isArray(message.content)
    && message.content.some((part: any) => part?.type === "toolCall" && SHARED_KNOWLEDGE_TOOLS.has(part.name));
}

function hasUnverifiedMemoryProvenance(entries: any[], piSessionId: string | null): boolean {
  const markers = entries.filter((entry) => entry?.type === "custom" && entry.customType === "pi67.memory-provenance.v1");
  if (markers.length === 0) return false; // External compatibility still uses its own OV scope anchor.
  const data = markers[0]?.data;
  return markers.length !== 1 || data?.version !== 1 || data.kind !== "private" || data.originSessionId !== piSessionId;
}

function findLatestSyncState(branch: any[]): unknown {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    const kind = entry?.customType ?? entry?.type;
    if (typeof kind === "string" && kind.startsWith("ov-sync-state-")) return entry.data ?? null;
  }
  return undefined;
}

function validSyncState(data: any, piSessionId: string, base: string, scopeKey: string): data is SyncStateData {
  return data?.version === 2
    && data.scopeKey === scopeKey
    && data.piSessionId === piSessionId
    && typeof data.ovSessionId === "string"
    && (data.ovSessionId === base || data.ovSessionId.startsWith(`${base}__lineage-`))
    && Number.isInteger(data.lineage) && data.lineage >= 0
    && Number.isInteger(data.syncedCaptureCount) && data.syncedCaptureCount >= 0
    && typeof data.prefixHash === "string" && /^[a-f0-9]{0,64}$/u.test(data.prefixHash);
}
