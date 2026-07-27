import { summarizeMetric } from "./performance-contract.mjs";
import { rendererStageAssetMiBSamples } from "./electron-renderer-resources.mjs";

export function createElectronRendererPerformanceMetrics(samples) {
  return [
    summarizeMetric({
      id: "welcomeRendererAssets",
      label: "Welcome production renderer asset files",
      unit: "MiB",
      samples: rendererStageAssetMiBSamples(samples.rendererResourceTransitions, "welcome"),
      budget: 0.6,
      evidenceLevel: "packaged",
      method: "Observed app://pi67 Welcome script/link assets mapped to production renderer build file bytes",
      limitations: ["File bytes do not represent transfer, parse, or decoded-memory cost."]
    }),
    summarizeMetric({
      id: "runtimeInitializationRendererAssets",
      label: "Incremental production renderer assets for Runtime initialization",
      unit: "MiB",
      samples: rendererStageAssetMiBSamples(samples.rendererResourceTransitions, "runtimeInitialization"),
      budget: 0.4,
      evidenceLevel: "packaged",
      method: "Observed app://pi67 assets added from workspace selection through ready lazy WorkspaceShell paint",
      limitations: ["File bytes do not represent transfer, parse, or decoded-memory cost."]
    }),
    summarizeMetric({
      id: "packagedCommandPaletteFeedback",
      label: "First packaged Command Palette loading feedback",
      unit: "ms",
      samples: samples.packagedCommandPaletteFeedback,
      budget: 50,
      evidenceLevel: "packaged",
      method: "Renderer performance.now from Ctrl/Cmd+K through visible loading status while the lazy CommandPalette chunk resolves",
      limitations: ["Uses a synthetic keyboard event inside the packaged sandboxed Renderer to exclude Playwright transport."]
    }),
    summarizeMetric({
      id: "packagedCommandPaletteFirstOpen",
      label: "First packaged Command Palette open",
      unit: "ms",
      samples: samples.packagedCommandPaletteFirstOpen,
      budget: 400,
      evidenceLevel: "packaged",
      method: "Renderer performance.now from the first Ctrl/Cmd+K handler path through lazy CommandPalette chunk and two-frame accessible dialog paint",
      limitations: [
        "Uses a synthetic keyboard event inside the packaged sandboxed Renderer to exclude Playwright transport and locator polling.",
        "Does not wait for command search completion or network-backed work."
      ]
    })
  ];
}
