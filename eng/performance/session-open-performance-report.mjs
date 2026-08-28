import {
  createReport,
  enforceReport,
  printReport,
  summarizeMetric,
  writeReport
} from "./performance-contract.mjs";

const LIMITATIONS = [
  "Uses generated Pi JSONL only and never reads user Sessions, Prompts, source, Tool payloads, images, or credentials.",
  "Measures the current Node host and temporary filesystem with warm operating-system caches; it is not power-cycle cold-storage evidence.",
  "Does not prove packaged Utility Process, MessagePort, Renderer paint, Provider, OneDrive, Defender, EDR, or redirected-profile behavior.",
  "Retained memory is a child-process RSS/heap delta after forced GC while the SDK manager, projection index, and first page remain reachable."
];

export function createSessionOpenPerformanceMetrics(workloads, samples) {
  return workloads.flatMap((workload) => {
    const values = samples[workload.id];
    if (!values) throw new Error(`Missing Session-open samples for ${workload.id}.`);
    const prefix = `sessionOpen${workload.metricSuffix}`;
    return [
      metric(prefix, "Open", `${workload.label} SessionManager.open`, "ms", values.openMs,
        "Published Pi SDK SessionManager.open on generated physical JSONL with cwdOverride"),
      metric(prefix, "EventLoopDelay", `${workload.label} synchronous-open event-loop delay`, "ms",
        values.eventLoopDelayMs, "Zero-delay setImmediate scheduled immediately before SessionManager.open"),
      metric(prefix, "ProjectionBind", `${workload.label} shared projection bind`, "ms",
        values.projectionBindMs, "SessionProjectionIndex.bind after authoritative SDK open"),
      metric(prefix, "FirstPage", `${workload.label} first conversation page`, "ms",
        values.firstPageMs, "Bounded recent ConversationPage from the shared projection index"),
      metric(prefix, "UserMessagePage", `${workload.label} latest user-message index page`, "ms",
        values.userMessagePageMs, "Projects only the requested latest 100 user-message index items"),
      metric(prefix, "RetainedRss", `${workload.label} retained resident memory`, "bytes",
        values.retainedRssBytes, "Child-process RSS delta after forced GC with opened Session retained"),
      metric(prefix, "RetainedHeap", `${workload.label} retained V8 heap`, "bytes",
        values.retainedHeapBytes, "Child-process heapUsed delta after forced GC with opened Session retained"),
      metric(prefix, "Messages", `${workload.label} generated message entries`, "count",
        values.messageCount, "Projection metadata count validated against fixture generation"),
      metric(prefix, "FixtureBytes", `${workload.label} generated JSONL bytes`, "bytes",
        values.fixtureBytes, "Synthetic physical fixture size after fsync"),
      metric(prefix, "FixtureWrite", `${workload.label} fixture generation and fsync`, "ms",
        values.fixtureWriteMs, "Excluded setup cost for generated JSONL creation and fsync"),
      metric(prefix, "FirstPageBytes", `${workload.label} first-page payload`, "bytes",
        values.firstPageBytes, "UTF-8 JSON bytes for the bounded recent ConversationPage"),
      metric(prefix, "UserMessagePageBytes", `${workload.label} user-message page payload`, "bytes",
        values.userMessagePageBytes, "UTF-8 JSON bytes for the latest 100 user-message index items")
    ];
  });
}

export async function writeSessionOpenPerformanceReport({ root, outputPath, profile, workloads, samples }) {
  const report = await createReport({
    root,
    suite: `session-open-${profile}`,
    metrics: createSessionOpenPerformanceMetrics(workloads, samples),
    unverified: [
      { id: "packagedUtilityProcess", reason: "This Node real-file suite does not launch packaged Electron." },
      { id: "coldStorage", reason: "Temporary-file samples do not emulate a power-cycle cold read." },
      ...(process.platform === "win32" ? [] : [{
        id: "windowsNative",
        reason: "Windows filesystem, Defender, EDR, OneDrive, and redirected-profile behavior require Windows x64 evidence."
      }])
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
    label,
    unit,
    samples,
    evidenceLevel: "node-real-file",
    method,
    limitations: LIMITATIONS
  });
}
