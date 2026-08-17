import {
  usageWindowDatesUtc,
  type UsageBucket,
  type UsageReport,
  type UsageTotals,
  type UsageWindow
} from "@pi67/domain";

export interface DailyUsagePoint {
  date: string;
  totals: UsageTotals;
}

export function createDailyUsageSeries(
  report: Pick<UsageReport, "buckets" | "generatedAt" | "window">
): DailyUsagePoint[] {
  const points = new Map(
    usageWindowDatesUtc(report.generatedAt, report.window)
      .map((date) => [date, { date, totals: emptyTotals() }] as const)
  );

  for (const bucket of report.buckets) {
    if (!bucket.date) continue;
    const point = points.get(bucket.date);
    if (!point) continue;
    addBucket(point.totals, bucket);
  }

  return [...points.values()];
}

export function usageAxisMaximum(points: readonly DailyUsagePoint[]): number {
  const maximum = Math.max(0, ...points.map((point) => point.totals.total));
  if (maximum === 0) return 4;
  const roughStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = Math.max(
    1,
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  );
  return step * 4;
}

export function usageAxisTicks(maximum: number): number[] {
  return Array.from({ length: 5 }, (_, index) => maximum - maximum * index / 4);
}

export function showUsageDateLabel(index: number, window: UsageWindow): boolean {
  const stride = window === "7d" ? 1 : window === "30d" ? 5 : 15;
  const days = window === "7d" ? 7 : window === "30d" ? 30 : 90;
  return index === 0 || index === days - 1 || index % stride === 0;
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function addBucket(target: UsageTotals, bucket: UsageBucket): void {
  target.input += bucket.totals.input;
  target.output += bucket.totals.output;
  target.cacheRead += bucket.totals.cacheRead;
  target.cacheWrite += bucket.totals.cacheWrite;
  target.total += bucket.totals.total;
  if (bucket.totals.recordedCost !== undefined) {
    target.recordedCost = (target.recordedCost ?? 0) + bucket.totals.recordedCost;
  }
}
