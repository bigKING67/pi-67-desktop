// Historical evaluation candidate retained outside the product runtime. The
// production OpenViking Extension follows upstream current-prompt Recall and a
// single official /find Tool request; this module exists only to reproduce the
// 2026-09-03 adaptive-policy A/B evidence.
const FAST_RECALL_SCORE_FLOOR = 0.72;
const FAST_RECALL_SCORE_MARGIN = 0.1;

export function decideCheapRecall(scores, configuredThreshold, canExpand) {
  if (!canExpand) return "return-fast";
  const finiteScores = scores.filter(Number.isFinite).map(clampScore);
  if (finiteScores.length === 0) return "expand";
  const [best = 0, runnerUp] = finiteScores;
  const strongThreshold = Math.max(FAST_RECALL_SCORE_FLOOR, clampScore(configuredThreshold));
  if (best < strongThreshold) return "expand";
  if (runnerUp === undefined) return "return-fast";
  return best - runnerUp >= FAST_RECALL_SCORE_MARGIN ? "return-fast" : "expand";
}

function clampScore(score) {
  return Math.max(0, Math.min(1, score));
}
