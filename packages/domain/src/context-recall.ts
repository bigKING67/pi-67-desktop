import type { MemoryScope } from "./context-memory.js";

export type RecallSource = "private-memory" | "private-experience" | "shared-experience" | "resource";

export const RECALL_FEEDBACK_KINDS = [
  "helpful",
  "irrelevant",
  "outdated",
  "wrong-scope",
  "incorrect"
] as const;

export type RecallFeedbackKind = (typeof RECALL_FEEDBACK_KINDS)[number];

export type RecallRoute =
  | "startup-context"
  | "scoped-find"
  | "find-fast"
  | "session-context"
  | "find-fallback"
  | "cache"
  | "enterprise-experience"
  | "enterprise-sop";

export interface ContextRecallItem {
  id: string;
  title: string;
  summary: string;
  source: RecallSource;
  scope: MemoryScope;
  score: number;
  createdAt: number;
  reason: string;
  expiresAt?: number;
  workspaceId?: string;
  route?: RecallRoute;
  durationMs?: number;
  candidateCount?: number;
  selectedCount?: number;
  feedback?: RecallFeedbackKind;
}

export interface ContextRecallMetrics {
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  fastPathRate: number;
  expansionRate: number;
  cacheHitRate: number;
  emptyRate: number;
  targetP95Ms: number;
  withinTarget: boolean;
}

export interface RecallMetricSample {
  durationMs: number;
  route: RecallRoute;
  selectedCount: number;
}

export function summarizeRecallMetrics(
  samples: readonly RecallMetricSample[],
  targetP95Ms = 1_500
): ContextRecallMetrics {
  const bounded = samples
    .filter((sample) => Number.isFinite(sample.durationMs) && sample.durationMs >= 0)
    .slice(-500);
  const durations = bounded.map((sample) => Math.round(sample.durationMs)).sort((a, b) => a - b);
  const sampleCount = durations.length;
  const ratio = (matches: number): number => sampleCount === 0 ? 0 : matches / sampleCount;
  const p50Ms = percentile(durations, 0.5);
  const p95Ms = percentile(durations, 0.95);
  return {
    sampleCount,
    p50Ms,
    p95Ms,
    fastPathRate: ratio(bounded.filter((sample) => sample.route === "find-fast").length),
    expansionRate: ratio(bounded.filter((sample) => sample.route === "session-context").length),
    cacheHitRate: ratio(bounded.filter((sample) => sample.route === "cache").length),
    emptyRate: ratio(bounded.filter((sample) => sample.selectedCount === 0).length),
    targetP95Ms,
    withinTarget: sampleCount === 0 || p95Ms <= targetP95Ms
  };
}

function percentile(sortedValues: readonly number[], quantile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sortedValues.length * quantile) - 1);
  return sortedValues[Math.min(index, sortedValues.length - 1)] ?? 0;
}
