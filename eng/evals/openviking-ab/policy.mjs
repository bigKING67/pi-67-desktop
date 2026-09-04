export const FAST_RECALL_SCORE_FLOOR = 0.72;
export const FAST_RECALL_SCORE_MARGIN = 0.1;

export function decideAdaptiveRoute(scores, configuredThreshold, canExpand = true) {
  return decideAdaptiveRouteWithPolicy(scores, configuredThreshold, {
    scoreFloor: FAST_RECALL_SCORE_FLOOR,
    scoreMargin: FAST_RECALL_SCORE_MARGIN,
  }, canExpand);
}

export function decideAdaptiveRouteWithPolicy(
  scores,
  configuredThreshold,
  { scoreFloor, scoreMargin },
  canExpand = true,
) {
  if (!canExpand) return "find-fast";
  const finiteScores = scores
    .filter(Number.isFinite)
    .map(clampScore);
  if (finiteScores.length === 0) return "context-expanded";
  const [best = 0, runnerUp] = finiteScores;
  const strongThreshold = Math.max(
    clampScore(scoreFloor),
    clampScore(configuredThreshold),
  );
  if (best < strongThreshold) return "context-expanded";
  if (runnerUp === undefined) return "find-fast";
  return best - runnerUp >= clampScore(scoreMargin)
    ? "find-fast"
    : "context-expanded";
}

export function normalizeFindEntries(envelope) {
  const result = envelope?.result && typeof envelope.result === "object"
    ? envelope.result
    : {};
  return ["memories", "resources", "skills"]
    .flatMap((bucket) => Array.isArray(result[bucket]) ? result[bucket] : [])
    .map(normalizeEntry)
    .filter((entry) => entry.uri);
}

export function normalizeContextEntries(envelope) {
  const entries = Array.isArray(envelope?.result?.entries)
    ? envelope.result.entries
    : [];
  return entries.map(normalizeEntry).filter((entry) => entry.uri);
}

function normalizeEntry(value) {
  return {
    uri: String(value?.uri ?? "").trim(),
    score: clampScore(Number(value?.score ?? 0)),
  };
}

function clampScore(value) {
  return Math.max(0, Math.min(1, value));
}
