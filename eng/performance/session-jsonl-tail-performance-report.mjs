import {
  createReport,
  enforceReport,
  printReport,
  summarizeMetric,
  writeReport
} from "./performance-contract.mjs";

export const SESSION_JSONL_TAIL_PERFORMANCE_BUDGETS = Object.freeze({});

const NODE_REAL_FILE_LIMITATIONS = [
  "Uses synthetic Pi-shaped JSONL records and never reads user Sessions, Prompts, source, Tool payloads, images, or credentials.",
  "Uses the current host filesystem and warm operating-system caches; it is not power-cycle cold-storage evidence.",
  "Does not prove packaged Electron Utility Process, MessagePort, Renderer, or cross-process recovery performance.",
  "Timed watcher checks call checkNow directly, so they exclude fs.watch callback coalescing and debounce latency.",
  "Windows x64, NTFS identity, OneDrive, junction/reparse-point, Defender, and slow-storage behavior require native platform evidence."
];

export function createSessionJsonlTailPerformanceMetrics(samples) {
  return [
    durationMetric(
      "sessionJsonlWatcherSelfAppend1KiB",
      "Pi-owned 1 KiB JSONL append acceptance",
      samples.selfAppend1KiBDurationMs,
      "Real file append is complete before timing; SessionJsonlWatcher.checkNow performs authoritative tail validation and self-write reconciliation"
    ),
    durationMetric(
      "sessionJsonlWatcherSelfAppend256KiB",
      "Pi-owned 256 KiB JSONL append acceptance",
      samples.selfAppend256KiBDurationMs,
      "Real file append is complete before timing; SessionJsonlWatcher.checkNow validates one 256 KiB physical record against the expected Pi-owned record"
    ),
    durationMetric(
      "sessionJsonlTailBoundedDrain4MiB",
      "4 MiB bounded JSONL tail drain",
      samples.boundedDrain4MiBDurationMs,
      "One 4 MiB real-file append is drained in 1 MiB passes with an event-loop yield between passes"
    ),
    structuralMetric(
      "sessionJsonlTailBoundedDrain4MiBBytes",
      "4 MiB drain bytes processed",
      "bytes",
      samples.boundedDrain4MiBBytesProcessed,
      "Sum of production drainSessionJsonlTail appendedBytes across the bounded drain"
    ),
    structuralMetric(
      "sessionJsonlTailBoundedDrain4MiBPasses",
      "4 MiB drain pass count",
      "count",
      samples.boundedDrain4MiBPassCount,
      "Count of bounded production tail drains required to reach the authoritative file end"
    ),
    structuralMetric(
      "sessionJsonlTailBoundedDrain4MiBYields",
      "4 MiB drain event-loop yields",
      "count",
      samples.boundedDrain4MiBEventLoopYieldCount,
      "Explicit zero-delay yield after every production drain that reports more bytes"
    ),
    structuralMetric(
      "sessionJsonlTailBoundedDrain4MiBPeakPending",
      "4 MiB drain peak pending physical line",
      "bytes",
      samples.boundedDrain4MiBPeakPendingLineBytes,
      "Largest pendingLine retained between bounded production tail passes"
    ),
    durationMetric(
      "sessionJsonlTailBoundary64MiB",
      "64 MiB physical-line boundary drain",
      samples.boundary64MiBDurationMs,
      "One valid 64 MiB physical JSON record plus LF is drained in 4 MiB passes; fixture generation and file append are excluded",
      ["This adversarial boundary uses a capped sample count because it intentionally exercises the maximum accepted physical line."]
    ),
    structuralMetric(
      "sessionJsonlTailBoundary64MiBBytes",
      "64 MiB boundary bytes processed",
      "bytes",
      samples.boundary64MiBBytesProcessed,
      "Sum of production drainSessionJsonlTail appendedBytes for the maximum accepted physical line"
    ),
    structuralMetric(
      "sessionJsonlTailBoundary64MiBPasses",
      "64 MiB boundary pass count",
      "count",
      samples.boundary64MiBPassCount,
      "Count of 4 MiB production tail drains, including the final LF-only pass"
    ),
    structuralMetric(
      "sessionJsonlTailBoundary64MiBPeakPending",
      "64 MiB boundary peak pending physical line",
      "bytes",
      samples.boundary64MiBPeakPendingLineBytes,
      "Largest pendingLine retained before the terminating LF is read"
    ),
    structuralMetric(
      "sessionJsonlTailBoundary64MiBYields",
      "64 MiB boundary event-loop yields",
      "count",
      samples.boundary64MiBEventLoopYieldCount,
      "Explicit zero-delay yield after every production drain that reports more bytes"
    ),
    durationMetric(
      "sessionJsonlWatcherSequentialSelfAppend1000",
      "1,000 sequential Pi-owned appendFile plus watcher checks",
      samples.sequentialSelfAppend1000DurationMs,
      "One watcher remains bound while 1,000 synthetic records are appended, added to the expected Pi state, and authoritatively checked one at a time"
    ),
    structuralMetric(
      "sessionJsonlWatcherSequentialSelfAppend1000Bytes",
      "1,000 sequential append bytes processed",
      "bytes",
      samples.sequentialSelfAppend1000BytesProcessed,
      "UTF-8 bytes appended across the 1,000-record watcher workload"
    ),
    structuralMetric(
      "sessionJsonlWatcherSequentialSelfAppend1000Records",
      "Sequential self-owned records processed",
      "count",
      samples.sequentialSelfAppend1000RecordsProcessed,
      "Pi-owned records accepted without an external-change conflict"
    ),
    durationMetric(
      "sessionJsonlWatcherExternalAppendDetection",
      "External append detection",
      samples.externalAppendDurationMs,
      "Unknown real-file record is appended before timing; checkNow must latch an appended conflict"
    ),
    durationMetric(
      "sessionJsonlTailTruncateDetection",
      "Truncate detection",
      samples.truncateDurationMs,
      "Real file is truncated before timing; production tail inspection must classify the authoritative size regression"
    ),
    durationMetric(
      "sessionJsonlTailAtomicReplaceDetection",
      "Atomic replace detection",
      samples.atomicReplaceDurationMs,
      "A replacement file is renamed over the active path before timing; production file identity must classify the replacement"
    ),
    durationMetric(
      "sessionJsonlWatcherMissingCreateAcceptance",
      "Missing Session file to matching first creation",
      samples.missingCreateDurationMs,
      "Watcher is bound before the file exists; timing covers authoritative acceptance after a complete matching file is created"
    ),
    durationMetric(
      "sessionJsonlWatcherGenerationDisposeRace",
      "Watcher generation switch and dispose race",
      samples.generationDisposeRaceDurationMs,
      "Real watchers switch generations, ignore a stale-path append, dispose, and flush two event-loop turns without reporting a late change"
    )
  ];
}

export async function writeSessionJsonlTailPerformanceReport({
  root,
  outputPath,
  samples,
  workloads,
  boundarySampleCount
}) {
  const report = await createReport({
    root,
    suite: "session-jsonl-tail",
    metrics: createSessionJsonlTailPerformanceMetrics(samples),
    unverified: [
      { id: "packagedUtilityProcess", reason: "This Node real-file suite does not launch packaged Electron or measure MessagePort transfer." },
      { id: "fsWatchLatency", reason: "Timed detection uses explicit checkNow; callback coalescing and debounce are not latency metrics." },
      { id: "windowsStorage", reason: "Windows x64, OneDrive, reparse-point, Defender, and slow-storage evidence requires a native host." },
      { id: "concurrentWriter", reason: "The product remains single-writer; the suite detects external mutation and does not benchmark concurrent merge semantics." }
    ]
  });
  report.workloads = {
    ...workloads,
    boundarySampleCount,
    evidenceLevel: "node-real-file",
    budgetPolicy: "informational-until-macos-and-windows-baselines"
  };
  await writeReport(outputPath, report);
  printReport(outputPath, report);
  enforceReport(report);
  return report;
}

function durationMetric(id, label, samples, method, limitations = []) {
  return summarizeMetric({
    id,
    label,
    unit: "ms",
    samples,
    evidenceLevel: "node-real-file",
    method,
    limitations: [...NODE_REAL_FILE_LIMITATIONS, ...limitations]
  });
}

function structuralMetric(id, label, unit, samples, method) {
  return summarizeMetric({
    id,
    label,
    unit,
    samples,
    evidenceLevel: "node-real-file",
    method,
    limitations: NODE_REAL_FILE_LIMITATIONS
  });
}
