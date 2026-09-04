export function renderReport(receipt) {
  const lines = [
    "# OpenViking A/B/C retrieval pilot",
    "",
    `Run: \`${receipt.runId}\``,
    `Status: **${receipt.status.toUpperCase()}**`,
    `Server: OpenViking ${receipt.server.version}`,
    `Corpus: \`${receipt.corpus.sha256}\` (${receipt.corpus.documents} documents / ${receipt.corpus.queries} queries)`,
    "",
    "| Profile | Hit@1 | Hit@3 | MRR | p50 | p95 | Requests | Routes |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const summary of receipt.summaries) {
    lines.push([
      `| ${summary.profile}`,
      percent(summary.hitAt1),
      percent(summary.hitAt3),
      summary.meanReciprocalRank.toFixed(3),
      `${summary.p50LatencyMs} ms`,
      `${summary.p95LatencyMs} ms`,
      String(summary.totalRequests),
      Object.entries(summary.routeCounts).map(([key, count]) => `${key}:${count}`).join(", "),
      "|",
    ].join(" | "));
  }
  const adaptive = receipt.summaries.find((summary) => summary.profile === "pi67-adaptive");
  if (adaptive) {
    lines.push(
      "",
      "## Adaptive cheap stage",
      "",
      `- Cheap Hit@1: ${percent(adaptive.cheapHitAt1)}`,
      `- Cheap Hit@3: ${percent(adaptive.cheapHitAt3)}`,
      `- Find latency p50/p95: ${adaptive.p50FindLatencyMs}/${adaptive.p95FindLatencyMs} ms`,
      `- Expanded context latency p50/p95: ${adaptive.p50ContextLatencyMs}/${adaptive.p95ContextLatencyMs} ms`,
      "",
      "## Counterfactual threshold replay",
      "",
      "The table below replays only lower or equal thresholds over the same live find/context responses. It is diagnostic evidence, not a production configuration decision.",
      "",
      "| Floor | Margin | Hit@1 | Hit@3 | p95 | Requests | Fast routes | Failures |",
      "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const replay of receipt.adaptiveReplays) {
      lines.push(`| ${replay.scoreFloor.toFixed(2)} | ${replay.scoreMargin.toFixed(2)} | ${percent(replay.hitAt1)} | ${percent(replay.hitAt3)} | ${replay.p95LatencyMs} ms | ${replay.totalRequests} | ${replay.routeCounts["find-fast"] ?? 0} | ${replay.failures} |`);
    }
  }
  lines.push(
    "",
    "## Boundaries",
    "",
    "- Synthetic shared Resources in one disposable Account only.",
    "- No existing private Memory, Session, Experience, or Pi JSONL was read.",
    "- Retrieval-only: this does not measure whether Pi chooses to call a Tool or whether a task succeeds.",
    "- No production, VPS, packaged application, or Windows evidence is claimed.",
    "",
    `Cleanup: ${receipt.cleanup.accountDeleted && receipt.cleanup.accountAbsentAfterDelete ? "PASS" : "FAILED"}`,
    "",
  );
  return lines.join("\n");
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
