import { summarizeMetric } from "./performance-contract.mjs";

export function createElectronLaunchPerformanceMetrics(samples) {
  return [
    summarizeMetric({
      id: "cleanProfileLaunch",
      label: "Clean-profile launch to usable window",
      unit: "ms",
      samples: samples.cleanProfileLaunch,
      budget: 3_000,
      evidenceLevel: "packaged",
      method: "New Electron user-data directory; first window and connected workspace action",
      limitations: ["The harness does not flush the operating-system file cache, so this is not a power-cycle cold start."]
    }),
    summarizeMetric({
      id: "cleanProfileElectronHandshake",
      label: "Clean-profile launch to Playwright Electron handshake",
      unit: "ms",
      samples: samples.cleanProfileElectronHandshake,
      evidenceLevel: "packaged",
      method: "Cumulative time from packaged process launch through the Playwright Electron automation handshake",
      limitations: ["Cumulative phase metric; it includes operating-system process and packaged resource startup work."]
    }),
    summarizeMetric({
      id: "cleanProfileFirstWindow",
      label: "Clean-profile launch to first BrowserWindow",
      unit: "ms",
      samples: samples.cleanProfileFirstWindow,
      evidenceLevel: "packaged",
      method: "Cumulative time from packaged process launch through ElectronApplication.firstWindow"
    }),
    summarizeMetric({
      id: "cleanProfileDomContentLoaded",
      label: "Clean-profile launch to renderer DOMContentLoaded",
      unit: "ms",
      samples: samples.cleanProfileDomContentLoaded,
      evidenceLevel: "packaged",
      method: "Cumulative time from packaged process launch through app:// renderer DOMContentLoaded"
    }),
    summarizeMetric({
      id: "cleanProfileWorkspaceActionVisible",
      label: "Clean-profile launch to visible Workspace action",
      unit: "ms",
      samples: samples.cleanProfileWorkspaceActionVisible,
      evidenceLevel: "packaged",
      method: "Cumulative time from packaged process launch through the visible Welcome Workspace action"
    }),
    summarizeMetric({
      id: "warmLaunch",
      label: "Warm-profile launch to usable window",
      unit: "ms",
      samples: samples.warmLaunch,
      budget: 1_800,
      evidenceLevel: "packaged",
      method: "Second packaged launch using the same clean profile"
    })
  ];
}
