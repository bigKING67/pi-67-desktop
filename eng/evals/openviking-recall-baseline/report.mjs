const COLUMNS = [
  ["Hit@1", "hitAt1", percent], ["Hit@3", "hitAt3", percent], ["MRR", "meanReciprocalRank", fixed],
  ["Full recall", "fullRecall", percent], ["Stale/distractor intrusion", "forbiddenIntrusion", percent],
  ["False injection", "falseInjection", percent], ["Peer leaks", "otherPeerLeaks", String],
  ["Entries", "meanEntries", fixed], ["Irrelevant entries", "meanIrrelevantEntries", fixed],
  ["Tokens (mean)", "meanUsedTokens", whole], ["p50 ms", "p50LatencyMs", whole], ["p95 ms", "p95LatencyMs", whole],
  ["Failures", "failures", String],
];

export function renderReport(receipt) {
  const lines = [
    "# OpenViking recall baseline", "",
    `Run \`${receipt.runId}\` · server ${receipt.server.version} · embedding ${receipt.embedding.model} (${receipt.embedding.dimension}d) · corpus \`${receipt.corpus.sha256.slice(0, 12)}\` · ${receipt.repetitions} repetitions`,
    `Source \`${receipt.source.gitHead.slice(0, 12)}\`${receipt.source.dirty ? " (dirty)" : ""} · runner \`${receipt.source.runnerSha256.slice(0, 12)}\` · cleanup ${receipt.cleanup?.dataRootRemoved && receipt.cleanup?.processExited ? "verified" : "FAILED"}`,
    "",
    "Rates are over applicable cases only: Hit/MRR over cases with an expected memory, full recall over multi-target, intrusion over cases with a stale/distractor memory, false injection over negative and cross-peer cases. `find-ceiling` is a diagnostic raw vector ranking (top 10, no quotas or threshold), not a product path.",
    "",
  ];
  const compared = Object.entries(receipt.summary);
  if (compared.length > 2) {
    const keys = [["Hit@1", "hitAt1", percent], ["Hit@3", "hitAt3", percent], ["MRR", "meanReciprocalRank", fixed],
      ["Full", "fullRecall", percent], ["Intrusion", "forbiddenIntrusion", percent], ["False inj.", "falseInjection", percent],
      ["Irrelevant", "meanIrrelevantEntries", fixed], ["Tokens", "meanUsedTokens", whole]];
    lines.push("## Comparison", "", `| Arm | Overrides | ${keys.map(([label]) => `train ${String(label)}`).join(" | ")} | ${keys.map(([label]) => `test ${String(label)}`).join(" | ")} |`,
      `| --- | --- | ${keys.map(() => "---:").join(" | ")} | ${keys.map(() => "---:").join(" | ")} |`);
    for (const [arm, data] of compared) {
      const overrides = receipt.variants?.find((variant) => variant.name === arm)?.overrides;
      const values = (split) => keys.map(([, key, format]) => cell(data.bySplit[split][key], format)).join(" | ");
      lines.push(`| ${arm} | ${overrides ? `\`${JSON.stringify(overrides)}\`` : "–"} | ${values("train")} | ${values("test")} |`);
    }
    lines.push("");
  }
  for (const [arm, data] of compared) {
    lines.push(`## ${arm}`, "", "| Slice | Cases | " + COLUMNS.map(([label]) => label).join(" | ") + " |",
      "| --- | ---: | " + COLUMNS.map(() => "---:").join(" | ") + " |");
    const rows = [["all", data.overall], ["train", data.bySplit.train], ["test", data.bySplit.test],
      ...Object.entries(data.byType).map(([type, summary]) => [`type: ${type}`, summary])];
    for (const [label, summary] of rows) {
      lines.push(`| ${label} | ${summary.cases} | ${COLUMNS.map(([, key, format]) => cell(summary[key], format)).join(" | ")} |`);
    }
    const spread = Object.entries(data.repetitionSpread)
      .filter(([, value]) => value)
      .map(([metric, value]) => `${metric} ${fixed(value.min)}–${fixed(value.max)} (σ ${fixed(value.stdev)})`);
    if (spread.length) lines.push("", `Repetition spread: ${spread.join("; ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function cell(value, format) {
  return value === null || value === undefined ? "–" : format(value);
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function fixed(value) {
  return Number(value).toFixed(3);
}

function whole(value) {
  return String(Math.round(value));
}
