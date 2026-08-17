export type UsageWindow = "7d" | "30d" | "90d";
export type UsageSource = "assistant-message" | "tool-result" | "compaction" | "branch-summary";

const UTC_DAY_MS = 24 * 60 * 60 * 1_000;

const USAGE_WINDOW_DAY_COUNTS: Record<UsageWindow, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90
};

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  recordedCost?: number;
}

export interface UsageBucket {
  date?: string;
  provider: string;
  model: string;
  source: UsageSource;
  sessions: number;
  turns: number;
  totals: UsageTotals;
}

export interface UsageModelSummary {
  provider: string;
  model: string;
  sessions: number;
  turns: number;
  totals: UsageTotals;
}

export interface UsageCoverage {
  discoveredSessions: number;
  scannedSessions: number;
  skippedSessions: number;
  unavailableSessions: number;
  invalidSessions: number;
  futureVersionSessions: number;
  undatedUsageEntries: number;
  complete: boolean;
}

export interface UsageReport {
  workspaceId: string;
  generatedAt: number;
  window: UsageWindow;
  buckets: UsageBucket[];
  models: UsageModelSummary[];
  totals: UsageTotals;
  coverage: UsageCoverage;
}

export const MAX_USAGE_REPORT_BUCKETS = 1_000;
export const MAX_USAGE_REPORT_MODELS = 1_000;
export const MAX_USAGE_REPORT_SESSIONS = 500;

export function usageWindowDayCount(window: UsageWindow): number {
  return USAGE_WINDOW_DAY_COUNTS[window];
}

export function usageWindowStartUtc(now: number, window: UsageWindow): number {
  const current = new Date(now);
  const currentUtcDay = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate()
  );
  return currentUtcDay - (usageWindowDayCount(window) - 1) * UTC_DAY_MS;
}

export function usageWindowEndUtcExclusive(now: number): number {
  const current = new Date(now);
  return Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() + 1
  );
}

export function usageWindowDatesUtc(now: number, window: UsageWindow): string[] {
  const start = usageWindowStartUtc(now, window);
  return Array.from(
    { length: usageWindowDayCount(window) },
    (_, index) => new Date(start + index * UTC_DAY_MS).toISOString().slice(0, 10)
  );
}
