import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import {
  MAX_USAGE_REPORT_BUCKETS,
  MAX_USAGE_REPORT_MODELS,
  MAX_USAGE_REPORT_SESSIONS,
  type SessionSummary,
  type UsageBucket,
  type UsageModelSummary,
  type UsageReport,
  type UsageSource,
  type UsageTotals,
  type UsageWindow,
  usageWindowEndUtcExclusive,
  usageWindowStartUtc
} from "@pi67/domain";

const MAX_USAGE_SESSION_BYTES = 16 * 1024 * 1024;
const MAX_USAGE_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_USAGE_JSONL_LINE_BYTES = 2 * 1024 * 1024;
const USAGE_SCAN_DEADLINE_MS = 5_000;

export interface SessionUsageScanOptions {
  workspaceId: string;
  sessions: readonly SessionSummary[];
  discoveredSessions: number;
  catalogIncomplete: boolean;
  catalogSkippedCount: number;
  window: UsageWindow;
  signal?: AbortSignal;
  now?: number;
}

interface MutableBucket {
  date?: string;
  provider: string;
  model: string;
  source: UsageSource;
  sessionIds: Set<string>;
  turns: number;
  totals: MutableTotals;
}

interface MutableModelSummary {
  provider: string;
  model: string;
  sessionIds: Set<string>;
  turns: number;
  totals: MutableTotals;
}

interface MutableTotals extends UsageTotals {
  costEntryCount: number;
}

export async function scanSessionUsage(options: SessionUsageScanOptions): Promise<UsageReport> {
  const now = options.now ?? Date.now();
  const since = usageWindowStartUtc(now, options.window);
  const until = usageWindowEndUtcExclusive(now);
  const deadline = Date.now() + USAGE_SCAN_DEADLINE_MS;
  const uniqueSessions = deduplicateSessions(options.sessions).slice(0, MAX_USAGE_REPORT_SESSIONS);
  const buckets = new Map<string, MutableBucket>();
  const models = new Map<string, MutableModelSummary>();
  const totals = emptyTotals();
  let bytesReadTotal = 0;
  let scannedSessions = 0;
  let unavailableSessions = 0;
  let invalidSessions = 0;
  let futureVersionSessions = 0;
  let undatedUsageEntries = 0;
  let bucketOverflow = false;
  let modelOverflow = false;
  let deadlineExceeded = false;

  for (const session of uniqueSessions) {
    if (options.signal?.aborted) throw usageScanCancelled();
    if (Date.now() >= deadline || bytesReadTotal >= MAX_USAGE_TOTAL_BYTES) {
      deadlineExceeded = true;
      break;
    }
    const loaded = await readTrustedSession(session.path, options.signal);
    if (loaded.kind === "unavailable") {
      unavailableSessions += 1;
      continue;
    }
    if (loaded.kind === "invalid") {
      invalidSessions += 1;
      continue;
    }
    if (bytesReadTotal + loaded.bytes > MAX_USAGE_TOTAL_BYTES) {
      deadlineExceeded = true;
      break;
    }
    bytesReadTotal += loaded.bytes;
    const entries: unknown[] = [];
    let invalidJson = false;
    for (const line of loaded.lines) {
      if (line.length === 0) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        invalidJson = true;
        break;
      }
    }
    if (invalidJson) {
      invalidSessions += 1;
      continue;
    }

    scannedSessions += 1;
    let sessionFuture = false;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      if (entry.type === "session") {
        const version = finiteInteger(entry.version) ?? 1;
        sessionFuture ||= version > CURRENT_SESSION_VERSION;
        continue;
      }
      const projected = usageEntry(entry, since, until);
      if (!projected) continue;
      if (projected.date === undefined) undatedUsageEntries += 1;
      addTotals(totals, projected.totals);
      const modelKey = `${projected.provider}\0${projected.model}`;
      let model = models.get(modelKey);
      if (!model) {
        if (models.size >= MAX_USAGE_REPORT_MODELS) {
          modelOverflow = true;
        } else {
          model = {
            provider: projected.provider,
            model: projected.model,
            sessionIds: new Set(),
            turns: 0,
            totals: emptyTotals()
          };
          models.set(modelKey, model);
        }
      }
      if (model) {
        model.sessionIds.add(session.fileIdentity);
        model.turns += 1;
        addTotals(model.totals, projected.totals);
      }
      const key = `${projected.date ?? "undated"}\0${projected.provider}\0${projected.model}\0${projected.source}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= MAX_USAGE_REPORT_BUCKETS) {
          bucketOverflow = true;
          continue;
        }
        bucket = {
          ...(projected.date === undefined ? {} : { date: projected.date }),
          provider: projected.provider,
          model: projected.model,
          source: projected.source,
          sessionIds: new Set(),
          turns: 0,
          totals: emptyTotals()
        };
        buckets.set(key, bucket);
      }
      bucket.sessionIds.add(session.fileIdentity);
      bucket.turns += 1;
      addTotals(bucket.totals, projected.totals);
    }
    if (sessionFuture) futureVersionSessions += 1;
  }

  const sessionLimitExceeded = options.sessions.length > uniqueSessions.length;
  const skippedSessions = Math.max(
    options.catalogSkippedCount,
    options.discoveredSessions - scannedSessions - unavailableSessions - invalidSessions
  );
  const complete = !options.catalogIncomplete
    && !sessionLimitExceeded
    && !deadlineExceeded
    && !bucketOverflow
    && !modelOverflow
    && unavailableSessions === 0
    && invalidSessions === 0
    && futureVersionSessions === 0
    && skippedSessions === 0;
  return {
    workspaceId: options.workspaceId,
    generatedAt: now,
    window: options.window,
    buckets: [...buckets.values()]
      .map(finalizeBucket)
      .sort(compareBuckets),
    models: [...models.values()]
      .map(finalizeModelSummary)
      .sort(compareModelSummaries),
    totals: finalizeTotals(totals),
    coverage: {
      discoveredSessions: options.discoveredSessions,
      scannedSessions,
      skippedSessions,
      unavailableSessions,
      invalidSessions,
      futureVersionSessions,
      undatedUsageEntries,
      complete
    }
  };
}

function usageEntry(
  entry: Record<string, unknown>,
  since: number,
  until: number
): {
  date?: string;
  provider: string;
  model: string;
  source: UsageSource;
  totals: MutableTotals;
} | undefined {
  let source: UsageSource;
  let usage: unknown;
  let provider = "unknown";
  let model = "unknown";
  let timestamp = timestampValue(entry.timestamp);
  if (entry.type === "message" && isRecord(entry.message)) {
    const message = entry.message;
    if (message.role === "assistant") {
      source = "assistant-message";
      provider = boundedLabel(message.provider);
      model = boundedLabel(message.model);
    } else if (message.role === "toolResult") {
      source = "tool-result";
    } else return undefined;
    usage = message.usage;
    timestamp = timestampValue(message.timestamp) ?? timestamp;
  } else if (entry.type === "compaction") {
    source = "compaction";
    usage = entry.usage;
  } else if (entry.type === "branch_summary") {
    source = "branch-summary";
    usage = entry.usage;
  } else return undefined;
  const totals = parseUsage(usage);
  if (!totals) return undefined;
  if (timestamp !== undefined && (timestamp < since || timestamp >= until)) return undefined;
  return {
    ...(timestamp === undefined ? {} : { date: new Date(timestamp).toISOString().slice(0, 10) }),
    provider,
    model,
    source,
    totals
  };
}

async function readTrustedSession(
  path: string,
  signal?: AbortSignal
): Promise<
  | { kind: "ok"; lines: string[]; bytes: number }
  | { kind: "unavailable" }
  | { kind: "invalid" }
> {
  try {
    const absolute = resolve(path);
    const pathStat = await lstat(absolute);
    if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1) {
      return { kind: "invalid" };
    }
    const canonical = await realpath(absolute);
    const handle = await open(canonical, "r");
    try {
      const before = await handle.stat();
      if (
        !before.isFile()
        || before.nlink !== 1
        || before.dev !== pathStat.dev
        || before.ino !== pathStat.ino
        || before.size !== pathStat.size
        || before.mtimeMs !== pathStat.mtimeMs
        || before.size > MAX_USAGE_SESSION_BYTES
      ) {
        return { kind: "invalid" };
      }
      if (signal?.aborted) throw usageScanCancelled();
      const buffer = Buffer.alloc(Math.max(0, Math.trunc(before.size)) + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const after = await handle.stat();
      if (
        bytesRead > MAX_USAGE_SESSION_BYTES
        || before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
      ) return { kind: "invalid" };
      const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
      const lines = content.split(/\r?\n/u);
      if (lines.some((line) => Buffer.byteLength(line, "utf8") > MAX_USAGE_JSONL_LINE_BYTES)) {
        return { kind: "invalid" };
      }
      return { kind: "ok", lines, bytes: bytesRead };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { kind: "unavailable" };
  }
}

function parseUsage(value: unknown): MutableTotals | undefined {
  if (!isRecord(value)) return undefined;
  const input = nonNegativeNumber(value.input);
  const output = nonNegativeNumber(value.output);
  const cacheRead = nonNegativeNumber(value.cacheRead);
  const cacheWrite = nonNegativeNumber(value.cacheWrite);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  const cost = isRecord(value.cost) ? nonNegativeNumber(value.cost.total) : undefined;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    ...(cost === undefined ? {} : { recordedCost: cost }),
    costEntryCount: cost === undefined ? 0 : 1
  };
}

function emptyTotals(): MutableTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costEntryCount: 0 };
}

function addTotals(target: MutableTotals, value: MutableTotals): void {
  target.input += value.input;
  target.output += value.output;
  target.cacheRead += value.cacheRead;
  target.cacheWrite += value.cacheWrite;
  target.total += value.total;
  if (value.costEntryCount > 0) {
    target.recordedCost = (target.recordedCost ?? 0) + (value.recordedCost ?? 0);
    target.costEntryCount += value.costEntryCount;
  }
}

function finalizeTotals(totals: MutableTotals): UsageTotals {
  return {
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    total: totals.total,
    ...(totals.costEntryCount === 0 ? {} : { recordedCost: totals.recordedCost ?? 0 })
  };
}

function finalizeBucket(bucket: MutableBucket): UsageBucket {
  return {
    ...(bucket.date === undefined ? {} : { date: bucket.date }),
    provider: bucket.provider,
    model: bucket.model,
    source: bucket.source,
    sessions: bucket.sessionIds.size,
    turns: bucket.turns,
    totals: finalizeTotals(bucket.totals)
  };
}

function finalizeModelSummary(model: MutableModelSummary): UsageModelSummary {
  return {
    provider: model.provider,
    model: model.model,
    sessions: model.sessionIds.size,
    turns: model.turns,
    totals: finalizeTotals(model.totals)
  };
}

function compareModelSummaries(left: UsageModelSummary, right: UsageModelSummary): number {
  return right.totals.total - left.totals.total
    || left.provider.localeCompare(right.provider)
    || left.model.localeCompare(right.model);
}

function compareBuckets(left: UsageBucket, right: UsageBucket): number {
  return (right.date ?? "").localeCompare(left.date ?? "")
    || right.totals.total - left.totals.total
    || left.provider.localeCompare(right.provider)
    || left.model.localeCompare(right.model);
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boundedLabel(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 128) : "unknown";
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deduplicateSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  const seen = new Set<string>();
  return sessions.filter((session) => {
    if (seen.has(session.fileIdentity)) return false;
    seen.add(session.fileIdentity);
    return true;
  });
}

function usageScanCancelled(): Error {
  return new DOMException("Session usage scan was cancelled.", "AbortError");
}
