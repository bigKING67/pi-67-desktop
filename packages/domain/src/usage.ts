export type UsageWindow = "7d" | "30d" | "90d";
export type UsageSource = "assistant-message" | "tool-result" | "compaction" | "branch-summary";

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
