import { summarizeMetric } from "./performance-contract.mjs";
import { rendererStageAssetMiBSamples } from "./electron-renderer-resources.mjs";

/**
 * Asset bytes are regression ratchets, not user-facing targets: app://pi67 serves them from local
 * disk, and launch and initialization time budgets carry the user outcome. A baseline moves only
 * with a cause recorded in docs/testing/performance.md ("Renderer asset ratchets").
 */
export const RENDERER_ASSET_RATCHETS = Object.freeze({
  welcome: Object.freeze({ baselineMiB: 0.638, tolerance: 0.05 }),
  runtimeInitialization: Object.freeze({ baselineMiB: 0.49, tolerance: 0.05 })
});

export function rendererAssetRatchetBudget({ baselineMiB, tolerance }) {
  return Math.round(baselineMiB * (1 + tolerance) * 1000) / 1000;
}

export function createElectronRendererPerformanceMetrics(samples) {
  return [
    summarizeMetric({
      id: "welcomeRendererAssets",
      label: "Welcome production renderer asset files",
      unit: "MiB",
      samples: rendererStageAssetMiBSamples(samples.rendererResourceTransitions, "welcome"),
      budget: rendererAssetRatchetBudget(RENDERER_ASSET_RATCHETS.welcome),
      evidenceLevel: "packaged",
      method: "Observed app://pi67 Welcome script/link assets mapped to production renderer build file bytes",
      limitations: ["File bytes do not represent transfer, parse, or decoded-memory cost.", "Regression ratchet: accepted baseline plus 5%."]
    }),
    summarizeMetric({
      id: "runtimeInitializationRendererAssets",
      label: "Incremental production renderer assets for Runtime initialization",
      unit: "MiB",
      samples: rendererStageAssetMiBSamples(samples.rendererResourceTransitions, "runtimeInitialization"),
      budget: rendererAssetRatchetBudget(RENDERER_ASSET_RATCHETS.runtimeInitialization),
      evidenceLevel: "packaged",
      method: "Observed app://pi67 assets added from workspace selection through ready lazy WorkspaceShell paint",
      limitations: ["File bytes do not represent transfer, parse, or decoded-memory cost.", "Regression ratchet: accepted baseline plus 5%."]
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
