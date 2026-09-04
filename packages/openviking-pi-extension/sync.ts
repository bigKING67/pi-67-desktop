import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildCommitRequestBody, type OVClient, type OVCommitResult } from "./client.js";
import type { OVConfig } from "./config.js";
import { extractBranchCapturePayloads } from "./lib/capture-adapter.mjs";
import { countUndeliveredForSession, estimatePayloadTokens } from "./lib/takeover-core.mjs";
import { enqueue, listPending, replayPending } from "./shared/pending-queue.mjs";
import { deriveHarnessSessionId } from "./shared/session-model.mjs";

export const SYNC_STATE_ENTRY_TYPE = "ov-sync-state-v1";

export interface AddPayloadResult {
  accepted: boolean;
  delivered: boolean;
}

export interface SyncBranchResult {
  added: number;
  tokens: number;
  allDelivered: boolean;
  lineageChanged: boolean;
}

type ReplayResult = Awaited<ReturnType<typeof replayPending>>;

interface SyncStateData {
  version: 1;
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

  restore(branch: any[], piSessionId: string, legacyWatermark = 0): void {
    this.sourcePiSessionId = piSessionId;
    const base = deriveHarnessSessionId("pi-", piSessionId);
    const restored = findLatestSyncState(branch, piSessionId, base);
    if (restored) {
      this.ovSessionId = restored.ovSessionId;
      this.lineage = restored.lineage;
      this.syncedCaptureCount = restored.syncedCaptureCount;
      this.prefixHash = restored.prefixHash;
      return;
    }

    // A pre-v1 count cannot prove branch identity. Start a separate lineage so
    // a resumed or rewritten branch can never be appended to the legacy OV Session.
    this.lineage = legacyWatermark > 0 ? 1 : 0;
    this.ovSessionId = this.lineageSessionId(base);
    this.syncedCaptureCount = 0;
    this.prefixHash = "";
  }

  restoreWatermark(n: number): void {
    this.syncedCaptureCount = Math.max(0, Math.floor(Number(n) || 0));
    this.prefixHash = "";
  }

  async ensureSession(piSessionId: string): Promise<boolean> {
    if (!this.sourcePiSessionId) this.sourcePiSessionId = piSessionId;
    if (this.sourcePiSessionId !== piSessionId) return false;
    this.ovSessionId ??= deriveHarnessSessionId("pi-", piSessionId);
    const queued = await enqueue("createSession", this.ovSessionId, {
      session_id: this.ovSessionId,
      auto_commit_policy: null,
    });
    if (!queued.ok) return false;
    if (!this.client.connected) return false;
    const replay = await this.replayPending();
    return replay.outcomes[queued.dedupKey] === "replayed";
  }

  async replayPending(): Promise<ReplayResult> {
    if (!this.client.connected) return emptyReplayResult();
    return replayPending(
      (path: string, init?: any) => this.client.fetchJSON(path, init, 10000),
      (stage: string, data: unknown) => debugLog(`${stage}: ${JSON.stringify(data)}`),
    );
  }

  async flushForTakeover(): Promise<boolean> {
    if (!this.ovSessionId) return false;
    await this.replayPending();
    const pending = await listPending();
    return countUndeliveredForSession(pending, this.ovSessionId) === 0;
  }

  async syncBranch(branch: any[]): Promise<SyncBranchResult> {
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
    return { added, tokens, allDelivered, lineageChanged };
  }

  async alignBranch(branch: any[]): Promise<boolean> {
    if (!this.ovSessionId || !this.sourcePiSessionId) return false;
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
    if (!this.ovSessionId) return { accepted: false, delivered: false };
    const queued = await enqueue("addMessage", this.ovSessionId, payload);
    if (!queued.ok) return { accepted: false, delivered: false };
    const replay = this.client.connected ? await this.replayPending() : emptyReplayResult();
    const outcome = replay.outcomes[queued.dedupKey];
    return {
      accepted: outcome !== "skipped",
      delivered: outcome === "replayed",
    };
  }

  async commitIfNeeded(): Promise<void> {
    if (!this.ovSessionId) return;
    const meta = await this.client.getSession(this.ovSessionId);
    if (Number(meta?.pending_tokens || 0) >= this.config.commitTokenThreshold) await this.commit();
  }

  async commit(opts: { queueOnFailure?: boolean; keepRecentCount?: number; keepRecentTurns?: number } = {}): Promise<OVCommitResult | null> {
    if (!this.ovSessionId) return null;
    const retention = opts.keepRecentTurns === undefined
      ? (opts.keepRecentCount ?? this.config.commitKeepRecentCount)
      : { keepRecentTurns: opts.keepRecentTurns };
    const response = await this.client.commitSessionResponse(this.ovSessionId, retention);
    const result = response.result;
    if (!result) {
      debugLog(`commit: session=${this.ovSessionId} ok=false status=${response.status ?? 0} trace_id=${response.traceId || "none"} error=${response.error?.message || response.error?.code || "unknown"}`);
      if (opts.queueOnFailure !== false) {
        await enqueue("commitSession", this.ovSessionId, buildCommitRequestBody(retention));
      }
      return null;
    }
    debugLog(`commit: session=${this.ovSessionId} ok=true status=${result.status || "unknown"} archived=${result.archived === true} trace_id=${result.trace_id || "none"}`);
    return result;
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
    if (!this.persistEntry || !this.ovSessionId || !this.sourcePiSessionId) return true;
    try {
      this.persistEntry(SYNC_STATE_ENTRY_TYPE, {
        version: 1,
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

function findLatestSyncState(branch: any[], piSessionId: string, base: string): SyncStateData | null {
  for (let index = (Array.isArray(branch) ? branch.length : 0) - 1; index >= 0; index--) {
    const entry = branch[index];
    const isState = (entry?.type === "custom" && entry.customType === SYNC_STATE_ENTRY_TYPE)
      || entry?.customType === SYNC_STATE_ENTRY_TYPE
      || entry?.type === SYNC_STATE_ENTRY_TYPE;
    const data = isState ? entry.data : null;
    if (!validSyncState(data, piSessionId, base)) continue;
    return data;
  }
  return null;
}

function validSyncState(data: any, piSessionId: string, base: string): data is SyncStateData {
  return data?.version === 1
    && data.piSessionId === piSessionId
    && (data.ovSessionId === base || data.ovSessionId.startsWith(`${base}__lineage-`))
    && Number.isInteger(data.lineage) && data.lineage >= 0
    && Number.isInteger(data.syncedCaptureCount) && data.syncedCaptureCount >= 0
    && typeof data.prefixHash === "string" && /^[a-f0-9]{0,64}$/u.test(data.prefixHash);
}
