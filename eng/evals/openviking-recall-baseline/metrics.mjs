const SPREAD_METRICS = ["hitAt1", "hitAt3", "meanReciprocalRank", "fullRecall", "forbiddenIntrusion", "falseInjection"];

/** Scores one retrieval against its case. Only synthetic URIs and numbers are kept. */
export function scoreCase(item, returnedUris, otherPeerPrefix) {
  const index = returnedUris.findIndex((uri) => item.expectedUris.includes(uri));
  const rank = index < 0 ? 0 : index + 1;
  const forbiddenIndexes = returnedUris
    .map((uri, position) => item.forbiddenUris.includes(uri) ? position : -1)
    .filter((position) => position >= 0);
  return {
    rank,
    hitAt1: rank === 1,
    hitAt3: rank > 0 && rank <= 3,
    reciprocalRank: rank > 0 ? 1 / rank : 0,
    fullRecall: item.expectedUris.length > 0 && item.expectedUris.every((uri) => returnedUris.includes(uri)),
    forbiddenIntrusion: forbiddenIndexes.some((position) => rank === 0 || position < index),
    otherPeerLeak: returnedUris.some((uri) => uri.startsWith(otherPeerPrefix)),
    falseInjection: item.expectedUris.length === 0 && returnedUris.length > 0,
    irrelevantEntries: returnedUris.filter((uri) => !item.expectedUris.includes(uri)).length,
  };
}

function summarize(results) {
  const positive = results.filter((result) => result.expectedCount > 0);
  const withForbidden = results.filter((result) => result.forbiddenCount > 0);
  const multi = results.filter((result) => result.type === "multi-target");
  const empty = results.filter((result) => result.expectedCount === 0);
  const ok = results.filter((result) => !result.errorCode);
  return {
    cases: results.length,
    failures: results.length - ok.length,
    hitAt1: rate(positive, (result) => result.score.hitAt1),
    hitAt3: rate(positive, (result) => result.score.hitAt3),
    meanReciprocalRank: mean(positive.map((result) => result.score.reciprocalRank)),
    fullRecall: rate(multi, (result) => result.score.fullRecall),
    forbiddenIntrusion: rate(withForbidden, (result) => result.score.forbiddenIntrusion),
    falseInjection: rate(empty, (result) => result.score.falseInjection),
    otherPeerLeaks: results.filter((result) => result.score.otherPeerLeak).length,
    meanEntries: mean(ok.map((result) => result.returnedUris.length)),
    meanIrrelevantEntries: mean(ok.map((result) => result.score.irrelevantEntries)),
    meanUsedTokens: mean(ok.map((result) => result.usedTokens)),
    p95UsedTokens: percentile(ok.map((result) => result.usedTokens), 0.95),
    p50LatencyMs: percentile(ok.map((result) => result.latencyMs), 0.5),
    p95LatencyMs: percentile(ok.map((result) => result.latencyMs), 0.95),
  };
}

/** Per arm: overall, by split, by case type, and spread of per-repetition aggregates. */
export function buildSummary(results) {
  const arms = {};
  for (const arm of unique(results.map((result) => result.arm))) {
    const armResults = results.filter((result) => result.arm === arm);
    const byRepetition = unique(armResults.map((result) => result.repetition))
      .map((repetition) => summarize(armResults.filter((result) => result.repetition === repetition)));
    arms[arm] = {
      overall: summarize(armResults),
      bySplit: Object.fromEntries(["train", "test"].map((split) => [
        split, summarize(armResults.filter((result) => result.split === split)),
      ])),
      byType: Object.fromEntries(unique(armResults.map((result) => result.type)).sort((left, right) => left.localeCompare(right)).map((type) => [
        type, summarize(armResults.filter((result) => result.type === type)),
      ])),
      repetitionSpread: Object.fromEntries(SPREAD_METRICS.map((metric) => {
        const values = byRepetition.map((summary) => summary[metric]).filter((value) => value !== null);
        return [metric, values.length ? { min: Math.min(...values), max: Math.max(...values), stdev: stdev(values) } : null];
      })),
    };
  }
  return arms;
}

export function assertNoSecretLiterals(serialized, secrets) {
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8 && serialized.includes(secret)) {
      throw new Error("Generated evaluation artifact contains a credential literal.");
    }
  }
}

function rate(items, predicate) {
  return items.length ? items.filter(predicate).length / items.length : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stdev(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function unique(values) {
  return [...new Set(values)];
}
