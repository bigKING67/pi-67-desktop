export function summarizeAgentResults(results) {
  const profiles = [...new Set(results.map((item) => item.profile))];
  return profiles.map((profile) => summarizeProfile(profile, results.filter((item) => item.profile === profile)));
}

export function smokeGate(results) {
  const failures = results.filter((item) => item.status !== "pass");
  const credentials = results.reduce((sum, item) => sum + item.credentialLiteralMatches, 0);
  const official = results.find((item) => item.profile === "official-context");
  const candidate = results.find((item) => item.profile === "pi67-find-only");
  const providerBounded = results.every((item) => (
    item.providerRequests > 0
    && item.providerRequests <= item.totalTurns * 4
  ));
  const candidateSearchCalls = candidate?.toolCalls?.viking_search ?? 0;
  const checks = {
    runFailures: failures.length === 0,
    credentialLiterals: credentials === 0,
    providerRequestsBounded: providerBounded,
    officialTaskSwitchSuccess: official?.successfulTurns === official?.totalTurns,
    candidateTaskSwitchSuccess: candidate?.successfulTurns === candidate?.totalTurns,
    candidateUsedSearchAfterSwitch: candidateSearchCalls >= 1,
    isolatedRuntimeCleanup: results.every((item) => item.isolatedRuntimeDeleted === true),
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

export function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

function summarizeProfile(profile, results) {
  const turns = results.flatMap((item) => item.turns);
  const memoryResults = results.filter((item) => item.scenarioKind !== "control");
  const controlResults = results.filter((item) => item.scenarioKind === "control");
  const usage = results.reduce((total, item) => addUsage(total, item.usage), emptyUsage());
  const toolCalls = {};
  const openVikingPaths = {};
  for (const result of results) {
    addCounts(toolCalls, result.toolCalls);
    addCounts(openVikingPaths, result.openVikingPaths);
  }
  const successfulMemoryTurns = memoryResults.reduce((sum, item) => sum + item.successfulTurns, 0);
  const totalMemoryTurns = memoryResults.reduce((sum, item) => sum + item.totalTurns, 0);
  const successfulControlTurns = controlResults.reduce((sum, item) => sum + item.successfulTurns, 0);
  const totalControlTurns = controlResults.reduce((sum, item) => sum + item.totalTurns, 0);
  return {
    profile,
    agentRuns: results.length,
    failedRuns: results.filter((item) => item.status !== "pass").length,
    turns: turns.length,
    taskSuccessRate: ratio(successfulMemoryTurns, totalMemoryTurns),
    controlSuccessRate: ratio(successfulControlTurns, totalControlTurns),
    providerRequests: results.reduce((sum, item) => sum + item.providerRequests, 0),
    providerRequestsPerRun: ratio(results.reduce((sum, item) => sum + item.providerRequests, 0), results.length),
    openVikingRequests: results.reduce((sum, item) => sum + item.openVikingRequests, 0),
    toolCalls,
    openVikingPaths,
    latencyP50Ms: percentile(results.map((item) => item.latencyMs), 0.5),
    latencyP95Ms: percentile(results.map((item) => item.latencyMs), 0.95),
    usage,
    tokensPerSuccessfulMemoryTurn: ratio(usage.totalTokens, successfulMemoryTurns),
    controlOpenVikingRequests: controlResults.reduce((sum, item) => sum + item.openVikingRequests, 0),
    controlMemoryToolCalls: controlResults.reduce((sum, item) => (
      sum + (item.toolCalls?.viking_search ?? 0) + (item.toolCalls?.viking_read ?? 0)
    ), 0),
  };
}

function addCounts(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) target[key] = (target[key] ?? 0) + value;
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, assistantMessages: 0 };
}

function addUsage(left, right) {
  return Object.fromEntries(Object.keys(left).map((key) => [key, left[key] + (right?.[key] ?? 0)]));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}
