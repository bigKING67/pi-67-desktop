import { decideAdaptiveRouteWithPolicy } from "./policy.mjs";

export function summarizeProfile(profile, cases) {
  const total = cases.length;
  const reciprocalRanks = cases.map((item) => reciprocalRank(
    item.returnedUris,
    item.expectedUri,
  ));
  const latencies = cases.map((item) => item.latencyMs);
  const routeCounts = countBy(cases.map((item) => item.route));
  return {
    profile,
    cases: total,
    hitAt1: ratio(cases.filter((item) => rankOf(item) === 1).length, total),
    hitAt3: ratio(cases.filter((item) => {
      const rank = rankOf(item);
      return rank > 0 && rank <= 3;
    }).length, total),
    meanReciprocalRank: mean(reciprocalRanks),
    meanRequestsPerCase: mean(cases.map((item) => item.requestCount)),
    totalRequests: cases.reduce((sum, item) => sum + item.requestCount, 0),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
    cheapHitAt1: hitRatio(cases, "findReturnedUris", 1),
    cheapHitAt3: hitRatio(cases, "findReturnedUris", 3),
    p50FindLatencyMs: percentile(cases.map((item) => item.findLatencyMs), 0.5),
    p95FindLatencyMs: percentile(cases.map((item) => item.findLatencyMs), 0.95),
    p50ContextLatencyMs: percentile(cases.map((item) => item.contextLatencyMs), 0.5),
    p95ContextLatencyMs: percentile(cases.map((item) => item.contextLatencyMs), 0.95),
    routeCounts,
    failures: cases.filter((item) => item.errorCode).length,
  };
}

export function summarizeAdaptiveReplays(cases, configuredThreshold) {
  const policies = [
    { scoreFloor: 0.45, scoreMargin: 0.05 },
    { scoreFloor: 0.45, scoreMargin: 0.1 },
    { scoreFloor: 0.5, scoreMargin: 0.05 },
    { scoreFloor: 0.5, scoreMargin: 0.1 },
    { scoreFloor: 0.55, scoreMargin: 0.05 },
    { scoreFloor: 0.55, scoreMargin: 0.1 },
    { scoreFloor: 0.6, scoreMargin: 0.05 },
    { scoreFloor: 0.6, scoreMargin: 0.1 },
    { scoreFloor: 0.65, scoreMargin: 0.05 },
    { scoreFloor: 0.65, scoreMargin: 0.1 },
    { scoreFloor: 0.72, scoreMargin: 0.1 },
  ];
  return policies.map((policy) => {
    const replayed = cases.map((item) => replayAdaptiveCase(
      item,
      configuredThreshold,
      policy,
    ));
    return { ...policy, ...summarizeProfile("adaptive-replay", replayed) };
  });
}

export function percentile(values, percentileValue) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (finite.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(percentileValue * finite.length));
  return finite[Math.min(finite.length - 1, rank - 1)];
}

export function assertArtifactSafe(value) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    /ark-[A-Za-z0-9-]{20,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bBearer\s+[A-Za-z0-9._-]{16,}/i,
    /"(?:apiKey|api_key|rootKey|root_key|userKey|user_key|accessToken|refreshToken)"\s*:/i,
  ];
  if (forbidden.some((pattern) => pattern.test(serialized))) {
    throw new Error("Generated OpenViking A/B artifact contains credential-like material.");
  }
}

function rankOf(item) {
  const index = item.returnedUris.indexOf(item.expectedUri);
  return index < 0 ? 0 : index + 1;
}

function reciprocalRank(uris, expectedUri) {
  const index = uris.indexOf(expectedUri);
  return index < 0 ? 0 : 1 / (index + 1);
}

function hitRatio(cases, field, limit) {
  const eligible = cases.filter((item) => Array.isArray(item[field]));
  if (eligible.length === 0) return 0;
  return ratio(eligible.filter((item) => {
    const index = item[field].indexOf(item.expectedUri);
    return index >= 0 && index < limit;
  }).length, eligible.length);
}

function replayAdaptiveCase(item, configuredThreshold, policy) {
  if (!Array.isArray(item.findScores)) return item;
  const route = decideAdaptiveRouteWithPolicy(
    item.findScores,
    configuredThreshold,
    policy,
    true,
  );
  const useFind = route === "find-fast";
  const failed = item.failedStage === "find"
    || (!useFind && item.errorCode !== undefined);
  return {
    ...item,
    returnedUris: useFind ? item.findReturnedUris : item.returnedUris,
    route,
    requestCount: useFind ? 1 : 2,
    latencyMs: useFind
      ? (item.findLatencyMs ?? 0)
      : (item.findLatencyMs ?? 0) + (item.contextLatencyMs ?? 0),
    ...(failed ? { errorCode: item.errorCode ?? "unavailable_replay_stage" } : { errorCode: undefined }),
  };
}

function mean(values) {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function countBy(values) {
  return Object.fromEntries(
    [...new Set(values)].sort((left, right) => left.localeCompare(right)).map((value) => [
      value,
      values.filter((candidate) => candidate === value).length,
    ]),
  );
}
