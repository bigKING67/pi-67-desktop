export function renderAgentPilotReport(receipt) {
  const lines = [
    "# OpenViking task-level Agent pilot",
    "",
    `- Run: \`${receipt.runId}\``,
    `- Mode: \`${receipt.mode}\``,
    `- Status: **${receipt.status.toUpperCase()}**`,
    `- Agent runs: ${receipt.execution.completedAgentRuns}/${receipt.execution.plannedAgentRuns}`,
    `- Provider model: \`${receipt.provider.modelId}\` via \`${receipt.provider.protocol}\``,
    `- OpenViking: \`${receipt.server.version}\``,
    `- Cleanup: ${receipt.cleanup.accountAbsentAfterDelete ? "PASS" : "FAILED"}`,
    "",
    "| Profile | Task success | Control | Provider requests | OV requests | p50 | p95 | Tokens | Memory Tools |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...receipt.summaries.map((summary) => [
      `| ${summary.profile}`,
      `${percent(summary.taskSuccessRate)}`,
      `${percent(summary.controlSuccessRate)}`,
      `${summary.providerRequests}`,
      `${summary.openVikingRequests}`,
      `${summary.latencyP50Ms} ms`,
      `${summary.latencyP95Ms} ms`,
      `${summary.usage.totalTokens}`,
      `${(summary.toolCalls.viking_search ?? 0) + (summary.toolCalls.viking_read ?? 0)} |`,
    ].join(" | ")),
    "",
    "## Safety and interpretation",
    "",
    `- Credential literal matches in isolated runtimes: ${receipt.execution.credentialLiteralMatches}`,
    `- Runtime failures: ${receipt.execution.failedAgentRuns}`,
    `- Provider cost projection: ${receipt.execution.providerCost}; a zero value means the custom catalog has no verified price table, not free usage.`,
    "- Synthetic task success measures evidence-code recovery, not production-corpus usefulness.",
    "- No production recall policy was changed by this run.",
    "",
  ];
  if (receipt.smokeGate) {
    lines.push("## Smoke gate", "", `Result: **${receipt.smokeGate.pass ? "PASS" : "FAILED"}**`, "");
    for (const [check, passed] of Object.entries(receipt.smokeGate.checks)) {
      lines.push(`- ${check}: ${passed ? "PASS" : "FAILED"}`);
    }
    lines.push("");
  }
  if (receipt.failure) lines.push("## Failure", "", `Code: \`${receipt.failure.code}\``, "");
  return lines.join("\n");
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
