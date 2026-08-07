import {
  createReport,
  enforceReport,
  printReport,
  summarizeMetric,
  writeReport
} from "./performance-contract.mjs";

export const SESSION_PROJECTION_PERFORMANCE_BUDGETS = Object.freeze({
  entryScans: 1,
  bootstrap10kMs: 100,
  olderPage10kMs: 50,
  recentPageBytes: 1_500_000
});

export function sessionProjectionMetrics(samples) {
  return [
    summarizeMetric({
      id: "sessionProjectionBind1k",
      label: "Build shared active-Session projection index for 1,000 messages",
      unit: "ms",
      samples: samples.bind1k,
      evidenceLevel: "node",
      method: "One SessionManager.getEntries read builds metadata, usage, branch lookup, and tree state"
    }),
    summarizeMetric({
      id: "sessionProjectionBind10k",
      label: "Build shared active-Session projection index for 10,000 messages",
      unit: "ms",
      samples: samples.bind10k,
      evidenceLevel: "node",
      method: "One SessionManager.getEntries read builds metadata, usage, branch lookup, and tree state"
    }),
    summarizeMetric({
      id: "sessionProjectionEntryScans10k",
      label: "Full SDK entry reads per 10,000-message projection bind",
      unit: "count",
      samples: samples.entryScans10k,
      budget: SESSION_PROJECTION_PERFORMANCE_BUDGETS.entryScans,
      evidenceLevel: "node",
      method: "Instrumented SessionManager.getEntries call count; the harness separately asserts exactly one read"
    }),
    summarizeMetric({
      id: "sessionProjectionBind100k",
      label: "Build shared active-Session projection index for 100,000 messages",
      unit: "ms",
      samples: samples.bind100k,
      evidenceLevel: "node",
      method: "One SessionManager.getEntries read builds metadata, usage, branch lookup, and tree state",
      limitations: ["Certification-scale timing is informational until multi-platform baselines are established."]
    }),
    summarizeMetric({
      id: "sessionProjectionEntryScans100k",
      label: "Full SDK entry reads per 100,000-message projection bind",
      unit: "count",
      samples: samples.entryScans100k,
      budget: SESSION_PROJECTION_PERFORMANCE_BUDGETS.entryScans,
      evidenceLevel: "node",
      method: "Instrumented SessionManager.getEntries call count; the harness separately asserts exactly one read"
    }),
    summarizeMetric({
      id: "sessionProjectionBootstrap100k",
      label: "Recent message page and bounded tree projection for 100,000 messages",
      unit: "ms",
      samples: samples.bootstrap100k,
      evidenceLevel: "node",
      method: "Shared projection index to recent 100-message page and bounded 512-node tree",
      limitations: ["Certification-scale timing is informational until multi-platform baselines are established."]
    }),
    summarizeMetric({
      id: "sessionProjectionOlderPage100k",
      label: "Stable-cursor older message page for 100,000 messages",
      unit: "ms",
      samples: samples.olderPage100k,
      evidenceLevel: "node",
      method: "Cached branch cursor lookup and bounded 200-message normalization",
      limitations: ["Certification-scale timing is informational until multi-platform baselines are established."]
    }),
    summarizeMetric({
      id: "sessionProjectionRecentPageBytes100k",
      label: "Recent message page payload for 100,000-message Session",
      unit: "bytes",
      samples: samples.recentPageBytes100k,
      budget: SESSION_PROJECTION_PERFORMANCE_BUDGETS.recentPageBytes,
      evidenceLevel: "node",
      method: "UTF-8 JSON bytes for the bounded recent ConversationPage"
    }),
    summarizeMetric({
      id: "sessionProjectionBootstrap1k",
      label: "Recent message page and bounded tree projection for 1,000 messages",
      unit: "ms",
      samples: samples.bootstrap1k,
      evidenceLevel: "node",
      method: "Shared projection index to recent 100-message page and bounded 512-node tree"
    }),
    summarizeMetric({
      id: "sessionProjectionBootstrap10k",
      label: "Recent message page and bounded tree projection for 10,000 messages",
      unit: "ms",
      samples: samples.bootstrap10k,
      budget: SESSION_PROJECTION_PERFORMANCE_BUDGETS.bootstrap10kMs,
      evidenceLevel: "node",
      method: "Shared projection index to recent 100-message page and bounded 512-node tree"
    }),
    summarizeMetric({
      id: "sessionProjectionOlderPage10k",
      label: "Stable-cursor older message page for 10,000 messages",
      unit: "ms",
      samples: samples.olderPage10k,
      budget: SESSION_PROJECTION_PERFORMANCE_BUDGETS.olderPage10kMs,
      evidenceLevel: "node",
      method: "Cached branch cursor lookup and bounded 200-message normalization"
    }),
    summarizeMetric({
      id: "sessionProjectionRecentPageBytes10k",
      label: "Recent message page payload for 10,000-message Session",
      unit: "bytes",
      samples: samples.recentPageBytes10k,
      budget: SESSION_PROJECTION_PERFORMANCE_BUDGETS.recentPageBytes,
      evidenceLevel: "node",
      method: "UTF-8 JSON bytes for the bounded recent ConversationPage"
    })
  ];
}

export async function writeSessionProjectionPerformanceReport({ root, outputPath, samples }) {
  const report = await createReport({
    root,
    suite: "session-projection",
    metrics: sessionProjectionMetrics(samples),
    unverified: [
      { id: "jsonlRead", reason: "In-memory fixtures exclude physical Pi JSONL parsing and disk latency." },
      { id: "packagedClone", reason: "Node evidence excludes Utility Process and MessagePort structured clone." },
      { id: "retainedRss", reason: "Retained runtime memory is measured by the packaged Electron suite." }
    ]
  });
  await writeReport(outputPath, report);
  printReport(outputPath, report);
  enforceReport(report);
  return report;
}
