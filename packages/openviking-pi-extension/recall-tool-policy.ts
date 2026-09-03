export const FAST_RECALL_SCORE_FLOOR = 0.72;
export const FAST_RECALL_SCORE_MARGIN = 0.1;
export const FAST_RECALL_POSITIVE_CACHE_MS = 120_000;
export const FAST_RECALL_EMPTY_CACHE_MS = 30_000;
export const FAST_RECALL_CACHE_CAPACITY = 64;

export type CheapRecallDecision = "return-fast" | "expand";

export function decideCheapRecall(
  scores: readonly number[],
  configuredThreshold: number,
  canExpand: boolean,
): CheapRecallDecision {
  if (!canExpand) return "return-fast";
  const finiteScores = scores.filter(Number.isFinite).map((score) => clampScore(score));
  if (finiteScores.length === 0) return "expand";
  const [best = 0, runnerUp] = finiteScores;
  const strongThreshold = Math.max(FAST_RECALL_SCORE_FLOOR, clampScore(configuredThreshold));
  if (best < strongThreshold) return "expand";
  if (runnerUp === undefined) return "return-fast";
  return best - runnerUp >= FAST_RECALL_SCORE_MARGIN ? "return-fast" : "expand";
}

export function cheapRecallCandidateLimit(requestedLimit: number): number {
  const normalized = Math.max(1, Math.min(8, Math.floor(requestedLimit)));
  return Math.min(8, Math.max(5, normalized + 2));
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export class RecallToolCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly capacity = FAST_RECALL_CACHE_CAPACITY,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, isEmpty: boolean): void {
    this.entries.delete(key);
    this.entries.set(key, {
      expiresAt: this.now() + (isEmpty ? FAST_RECALL_EMPTY_CACHE_MS : FAST_RECALL_POSITIVE_CACHE_MS),
      value,
    });
    while (this.entries.size > Math.max(1, this.capacity)) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export function recallCacheKey(input: {
  query: string;
  scope?: string;
  limit: number;
  sessionId?: string;
}): string {
  return JSON.stringify([
    input.query.trim().toLocaleLowerCase(),
    input.scope?.trim() ?? "",
    input.limit,
    input.sessionId?.trim() ?? "",
  ]);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}
