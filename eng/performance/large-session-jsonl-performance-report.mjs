import {
  createReport,
  enforceReport,
  printReport,
  summarizeMetric,
  writeReport
} from "./performance-contract.mjs";

const LIMITATIONS = [
  "Uses synthetic Pi-shaped JSONL records and never reads user Sessions, Prompts, source, Tool payloads, images, or credentials.",
  "Fixture generation and append time are reported separately and excluded from the production tail-drain duration.",
  "Uses the current host temporary filesystem and warm operating-system caches; it is not power-cycle cold-storage evidence.",
  "Does not prove packaged Utility Process, MessagePort, Renderer, provider, or physical-display performance.",
  "Windows Defender, OneDrive, junction/reparse-point, and slow-storage behavior require matching native platform evidence."
];

export function createLargeSessionJsonlPerformanceMetrics(workloads, samples) {
  return workloads.flatMap((workload) => {
    const values = samples[workload.id];
    if (!values) throw new Error(`Missing large Session JSONL samples for ${workload.id}.`);
    const prefix = `sessionJsonlLarge${workload.metricSuffix}`;
    const method = `${workload.label}; production drainSessionJsonlTail in 4 MiB passes with an event-loop yield between passes`;
    return [
      metric(prefix, "Drain", "bounded tail drain", "ms", values.durationMs, method),
      metric(prefix, "FixtureWrite", "synthetic fixture append and fsync", "ms", values.fixtureWriteMs,
        `${workload.label}; temporary synthetic JSONL generation, append, and fsync`),
      metric(prefix, "Bytes", "drain bytes processed", "bytes", values.bytesProcessed, method),
      metric(prefix, "Records", "records processed", "count", values.recordsProcessed, method),
      metric(prefix, "Passes", "bounded drain passes", "count", values.passCount, method),
      metric(prefix, "PeakPending", "peak pending physical line", "bytes", values.peakPendingLineBytes, method),
      metric(prefix, "Yields", "event-loop yields", "count", values.eventLoopYieldCount, method)
    ];
  });
}

export async function writeLargeSessionJsonlPerformanceReport({
  root,
  outputPath,
  profile,
  workloads,
  samples
}) {
  const report = await createReport({
    root,
    suite: `large-session-jsonl-${profile}`,
    metrics: createLargeSessionJsonlPerformanceMetrics(workloads, samples),
    unverified: [
      { id: "packagedUtilityProcess", reason: "This real-file certification does not launch packaged Electron." },
      { id: "coldStorage", reason: "Temporary-file measurements use current host caches and do not emulate a power-cycle cold read." },
      { id: "platformStorageFixtures", reason: "OneDrive, Defender, reparse-point, network, and deliberately slow storage need separate platform fixtures." }
    ]
  });
  await writeReport(outputPath, report);
  printReport(outputPath, report);
  enforceReport(report);
  return report;
}

function metric(prefix, suffix, label, unit, samples, method) {
  return summarizeMetric({
    id: `${prefix}${suffix}`,
    label: `${prefix.includes("500MiB") ? "500 MiB" : "100 MiB"} large Session ${label}`,
    unit,
    samples,
    evidenceLevel: "node-real-file-certification",
    method,
    limitations: LIMITATIONS
  });
}
