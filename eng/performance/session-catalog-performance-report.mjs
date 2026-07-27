import {
  createReport,
  enforceReport,
  printReport,
  summarizeMetric,
  writeReport
} from "./performance-contract.mjs";

export const SESSION_CATALOG_PERFORMANCE_BUDGETS = Object.freeze({
  warmFirstPage1kMs: 50,
  warmFirstPage10kMs: 100,
  searchMiss10kMs: 150,
  pageBytes10k: 1_500_000
});

const NODE_EVIDENCE_LIMITATIONS = [
  "Uses generated metadata records and does not measure Pi SDK JSONL discovery.",
  "Does not prove packaged Electron Utility Process performance or cross-process transfer cost.",
  "Does not prove Windows, OneDrive, junction, antivirus, or network-filesystem behavior.",
  "Contains no transcript, Prompt, Assistant, Thinking, Tool, Source, Patch, or Image content."
];

export function createSessionCatalogPerformanceMetrics(samples) {
  return [
    summarizeMetric({
      id: "sessionCatalogColdRebuild1k",
      label: "1,000-session cold SQLite projection rebuild",
      unit: "ms",
      samples: samples.coldRebuild1k,
      evidenceLevel: "node",
      method: "Fresh temporary SQLite catalog; explicit reconcile of 1,000 metadata records; fixture generation excluded",
      limitations: [
        ...NODE_EVIDENCE_LIMITATIONS,
        "Cold rebuild is informational and is not a release gate."
      ]
    }),
    summarizeMetric({
      id: "sessionCatalogColdRebuild10k",
      label: "10,000-session cold SQLite projection rebuild",
      unit: "ms",
      samples: samples.coldRebuild10k,
      evidenceLevel: "node",
      method: "Fresh temporary SQLite catalog; explicit reconcile of 10,000 metadata records; fixture generation excluded",
      limitations: [
        ...NODE_EVIDENCE_LIMITATIONS,
        "Cold rebuild is informational and is not a release gate."
      ]
    }),
    summarizeMetric({
      id: "sessionCatalogWarmFirstPage1k",
      label: "1,000-session warm first page",
      unit: "ms",
      samples: samples.warmFirstPage1k,
      budget: SESSION_CATALOG_PERFORMANCE_BUDGETS.warmFirstPage1kMs,
      evidenceLevel: "node",
      method: "Validated SQLite projection; workspace query for the latest 50 sessions after reconcile",
      limitations: NODE_EVIDENCE_LIMITATIONS
    }),
    summarizeMetric({
      id: "sessionCatalogWarmFirstPage10k",
      label: "10,000-session warm first page",
      unit: "ms",
      samples: samples.warmFirstPage10k,
      budget: SESSION_CATALOG_PERFORMANCE_BUDGETS.warmFirstPage10kMs,
      evidenceLevel: "node",
      method: "Validated SQLite projection; workspace query for the latest 50 sessions after reconcile",
      limitations: NODE_EVIDENCE_LIMITATIONS
    }),
    summarizeMetric({
      id: "sessionCatalogWarmNextPage10k",
      label: "10,000-session warm next page",
      unit: "ms",
      samples: samples.warmNextPage10k,
      evidenceLevel: "node",
      method: "Validated SQLite projection; second 50-session workspace page using the first page revision cursor",
      limitations: NODE_EVIDENCE_LIMITATIONS
    }),
    summarizeMetric({
      id: "sessionCatalogSearchHit10k",
      label: "10,000-session search hit",
      unit: "ms",
      samples: samples.searchHit10k,
      evidenceLevel: "node",
      method: "Validated SQLite projection; normalized workspace search for one explicit metadata name",
      limitations: NODE_EVIDENCE_LIMITATIONS
    }),
    summarizeMetric({
      id: "sessionCatalogSearchMiss10k",
      label: "10,000-session search miss",
      unit: "ms",
      samples: samples.searchMiss10k,
      budget: SESSION_CATALOG_PERFORMANCE_BUDGETS.searchMiss10kMs,
      evidenceLevel: "node",
      method: "Validated SQLite projection; normalized workspace search that scans to zero metadata matches",
      limitations: NODE_EVIDENCE_LIMITATIONS
    }),
    summarizeMetric({
      id: "sessionCatalogPageBytes10k",
      label: "10,000-session first-page JSON size",
      unit: "bytes",
      samples: samples.pageBytes10k,
      budget: SESSION_CATALOG_PERFORMANCE_BUDGETS.pageBytes10k,
      evidenceLevel: "node",
      method: "UTF-8 byte length of JSON.stringify for the warm 50-session first page",
      limitations: NODE_EVIDENCE_LIMITATIONS
    }),
    summarizeMetric({
      id: "sessionCatalogReopen10k",
      label: "10,000-session catalog reopen and first page",
      unit: "ms",
      samples: samples.reopen10k,
      evidenceLevel: "node",
      method: "Dispose, reopen the same SQLite database, validate its schema and existing projection, then query the first page",
      limitations: [
        ...NODE_EVIDENCE_LIMITATIONS,
        "The automatically scheduled reconcile is drained after the timed query and is not included in this metric."
      ]
    })
  ];
}

export async function writeSessionCatalogPerformanceReport({ root, outputPath, samples }) {
  const report = await createReport({
    root,
    suite: "session-catalog",
    metrics: createSessionCatalogPerformanceMetrics(samples),
    unverified: [
      { id: "piSdkJsonlDiscovery", reason: "The metadata fixture deliberately excludes Pi JSONL discovery and transcript parsing." },
      { id: "packagedUtilityProcess", reason: "This Node-host suite does not launch packaged Electron or measure MessagePort transfer." },
      { id: "windowsStorage", reason: "Real Windows x64, OneDrive, reparse-point, antivirus, and slow-storage evidence requires the native CI or release host." }
    ]
  });
  await writeReport(outputPath, report);
  printReport(outputPath, report);
  enforceReport(report);
  return report;
}
