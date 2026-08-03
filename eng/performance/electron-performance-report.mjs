import {
  createReport,
  enforceReport,
  printReport,
  summarizeMetric,
  writeReport
} from "./performance-contract.mjs";
import {
  printRendererResourceAttribution,
  summarizeRendererResourceTransitions
} from "./electron-renderer-resources.mjs";
import { createElectronLaunchPerformanceMetrics } from "./electron-launch-performance-metrics.mjs";
import { createElectronRendererPerformanceMetrics } from "./electron-renderer-performance-metrics.mjs";

export async function writeElectronPerformanceReport({
  root,
  outputPath,
  platform,
  defaultMessagePageSize,
  samples
}) {
  const ownedMemoryMethod = platform === "darwin"
    ? "macOS footprint phys_footprint; kernel-accounted effective process footprint"
    : "Win32 Win32_Process.PrivatePageCount; committed private pages";
  const ownedMemoryLimitations = platform === "darwin"
    ? ["phys_footprint is not directly comparable with Windows PrivatePageCount; reports remain platform-specific."]
    : ["PrivatePageCount is not directly comparable with macOS phys_footprint; reports remain platform-specific."];
  const rendererResources = summarizeRendererResourceTransitions(samples.rendererResourceTransitions);
  const rendererMetrics = createElectronRendererPerformanceMetrics(samples);
  const metrics = [
    ...createElectronLaunchPerformanceMetrics(samples),
    ...rendererMetrics.slice(0, 2),
    summarizeMetric({
      id: "welcomeIdleWorkingSet",
      label: "On-demand Welcome Main + renderer resident working set",
      unit: "MiB",
      samples: samples.welcomeMemory,
      budget: 350,
      evidenceLevel: "packaged",
      method: platform === "win32"
        ? "Win32 WorkingSetSize for packaged Main and renderer before Agent Host demand"
        : "macOS RSS for packaged Main and renderer before Agent Host demand",
      limitations: ["Summed process working sets can double-count shared pages; GPU and network utility processes are excluded."]
    }),
    summarizeMetric({
      id: "warmRestoredWorkspaceWorkingSet",
      label: "Warm restored Workspace Main + renderer resident working set",
      unit: "MiB",
      samples: samples.warmRestoredWorkspaceMemory,
      evidenceLevel: "packaged",
      method: platform === "win32" ? "Win32 WorkingSetSize for packaged Main and restored Workspace renderer before Agent Host demand" : "macOS RSS for packaged Main and restored Workspace renderer before Agent Host demand",
      limitations: ["Informational restored-Workspace state; it is intentionally excluded from the Welcome budget distribution.", "Summed process working sets can double-count shared pages; GPU and network utility processes are excluded."]
    }),
    summarizeMetric({
      id: "warmRestoredWorkspaceOwnedMemory",
      label: "Warm restored Workspace Main + renderer owned/effective memory",
      unit: "MiB",
      samples: samples.warmRestoredWorkspaceOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; Main and restored Workspace renderer sum before Agent Host demand`,
      limitations: ["Informational restored-Workspace state; it is intentionally excluded from the Welcome budget distribution.", ...ownedMemoryLimitations]
    }),
    summarizeMetric({
      id: "mainWorkingSet",
      label: "Electron Main resident working set",
      unit: "MiB",
      samples: samples.mainMemory,
      evidenceLevel: "packaged",
      method: "Main process component of welcomeIdleWorkingSet"
    }),
    summarizeMetric({
      id: "rendererWorkingSet",
      label: "Renderer resident working set",
      unit: "MiB",
      samples: samples.rendererMemory,
      evidenceLevel: "packaged",
      method: "Renderer process component of welcomeIdleWorkingSet"
    }),
    summarizeMetric({
      id: "welcomeOwnedMemory",
      label: "On-demand Welcome Main + renderer owned/effective memory",
      unit: "MiB",
      samples: samples.welcomeOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; Main and renderer sum before Agent Host demand`,
      limitations: ownedMemoryLimitations
    }),
    summarizeMetric({
      id: "mainOwnedMemory",
      label: "Electron Main owned/effective memory on Welcome",
      unit: "MiB",
      samples: samples.mainOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; Main process component before Agent Host demand`
    }),
    summarizeMetric({
      id: "rendererOwnedMemory",
      label: "Renderer owned/effective memory on Welcome",
      unit: "MiB",
      samples: samples.rendererOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; renderer process component before Agent Host demand`
    }),
    summarizeMetric({
      id: "connectedAgentHostWorkingSet",
      label: "Main + renderer + connected unloaded Agent Host working set",
      unit: "MiB",
      samples: samples.connectedMemory,
      evidenceLevel: "packaged",
      method: "Explicit Agent Host demand followed by Main, renderer, and node utility process working-set sum",
      limitations: ["Pi SDK is still unloaded; initialized runtime memory is a separate required scenario.", "Summed RSS can double-count shared pages."]
    }),
    summarizeMetric({
      id: "agentHostWorkingSet",
      label: "Agent Host resident working set",
      unit: "MiB",
      samples: samples.agentHostMemory,
      evidenceLevel: "packaged",
      method: "node.mojom.NodeService component after explicit Agent Host demand"
    }),
    summarizeMetric({
      id: "connectedAgentHostOwnedMemory",
      label: "Main + renderer + connected unloaded Agent Host owned/effective memory",
      unit: "MiB",
      samples: samples.connectedOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; three-process sum after explicit Agent Host demand`,
      limitations: [
        "Pi SDK is still unloaded; initialized runtime memory is a separate required scenario.",
        ...ownedMemoryLimitations
      ]
    }),
    summarizeMetric({
      id: "connectedMainOwnedMemory",
      label: "Electron Main owned/effective memory after Agent Host demand",
      unit: "MiB",
      samples: samples.connectedMainOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; Main process component before Pi SDK initialization`
    }),
    summarizeMetric({
      id: "connectedRendererOwnedMemory",
      label: "Renderer owned/effective memory after Agent Host demand",
      unit: "MiB",
      samples: samples.connectedRendererOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; renderer process component before Pi SDK initialization`
    }),
    summarizeMetric({
      id: "connectedAgentHostOwnedMemoryComponent",
      label: "Connected unloaded Agent Host owned/effective memory",
      unit: "MiB",
      samples: samples.connectedAgentHostOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; node utility process component before Pi SDK initialization`,
      limitations: ["This is the utility-process baseline before loading the Pi SDK."]
    }),
    summarizeMetric({
      id: "initializedRuntimeWorkingSet",
      label: "Main + renderer + initialized Pi SDK Agent Host working set",
      unit: "MiB",
      samples: samples.initializedRuntimeMemory,
      evidenceLevel: "packaged",
      method: "Isolated PI_CODING_AGENT_DIR and workspace, real Pi SDK session initialization, then three-process working-set sum",
      limitations: ["The session has no provider turn, large transcript, or loaded user extension set.", "Summed RSS can double-count shared pages."]
    }),
    summarizeMetric({
      id: "initializedRuntimeMainWorkingSet",
      label: "Electron Main working set after Pi Runtime initialization",
      unit: "MiB",
      samples: samples.initializedRuntimeMainMemory,
      evidenceLevel: "packaged",
      method: "Main process component of initializedRuntimeWorkingSet"
    }),
    summarizeMetric({
      id: "initializedRuntimeRendererWorkingSet",
      label: "Renderer working set after Pi Runtime initialization",
      unit: "MiB",
      samples: samples.initializedRuntimeRendererMemory,
      evidenceLevel: "packaged",
      method: "Renderer process component of initializedRuntimeWorkingSet"
    }),
    summarizeMetric({
      id: "initializedRuntimeAgentHostWorkingSet",
      label: "Agent Host working set after Pi Runtime initialization",
      unit: "MiB",
      samples: samples.initializedRuntimeAgentHostMemory,
      evidenceLevel: "packaged",
      method: "Agent Host component of initializedRuntimeWorkingSet"
    }),
    summarizeMetric({
      id: "initializedRuntimeOwnedMemory",
      label: "Main + renderer + initialized Pi SDK Agent Host owned/effective memory",
      unit: "MiB",
      samples: samples.initializedRuntimeOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; three-process sum after real Pi SDK session initialization`,
      limitations: [
        "The session has no provider turn, large transcript, or loaded user extension set.",
        ...ownedMemoryLimitations
      ]
    }),
    summarizeMetric({
      id: "initializedRuntimeMainOwnedMemory",
      label: "Electron Main owned/effective memory after Pi Runtime initialization",
      unit: "MiB",
      samples: samples.initializedRuntimeMainOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; Main process component`
    }),
    summarizeMetric({
      id: "initializedRuntimeRendererOwnedMemory",
      label: "Renderer owned/effective memory after Pi Runtime initialization",
      unit: "MiB",
      samples: samples.initializedRuntimeRendererOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; renderer process component`
    }),
    summarizeMetric({
      id: "initializedRuntimeAgentHostOwnedMemory",
      label: "Agent Host owned/effective memory after Pi Runtime initialization",
      unit: "MiB",
      samples: samples.initializedRuntimeAgentHostOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; node utility process component`
    }),
    summarizeMetric({
      id: "runtimeInitialization",
      label: "Workspace selection to initialized usable Pi Runtime",
      unit: "ms",
      samples: samples.runtimeInitialization,
      evidenceLevel: "packaged",
      method: "User-visible workspace action through native dialog bridge, Pi SDK ready state, and lazy conversation shell paint",
      limitations: ["Informational until representative Windows and macOS multi-version baselines establish a release budget."]
    }),
    ...rendererMetrics.slice(2),
    summarizeMetric({
      id: "runtimeInitializationWorkingSetDelta",
      label: "Aggregate working-set change while initializing the Pi Runtime",
      unit: "MiB",
      samples: samples.runtimeInitializationWorkingSetDelta,
      evidenceLevel: "packaged",
      method: "Per-sample initialized Runtime aggregate minus the connected unloaded Agent Host aggregate",
      limitations: ["This is a sampled RSS delta, not retained-heap attribution.", "Summed RSS can double-count shared pages."]
    }),
    summarizeMetric({
      id: "runtimeInitializationAgentHostDelta",
      label: "Agent Host working-set change while initializing the Pi Runtime",
      unit: "MiB",
      samples: samples.runtimeInitializationAgentHostDelta,
      evidenceLevel: "packaged",
      method: "Per-sample Agent Host RSS after Runtime initialization minus its connected unloaded RSS",
      limitations: ["This includes Pi SDK, models, resources, extensions, and Session initialization."]
    }),
    summarizeMetric({
      id: "runtimeInitializationOwnedMemoryDelta",
      label: "Aggregate owned/effective-memory change while initializing the Pi Runtime",
      unit: "MiB",
      samples: samples.runtimeInitializationOwnedMemoryDelta,
      evidenceLevel: "packaged",
      method: "Per-sample initialized Runtime owned/effective sum minus connected unloaded Agent Host sum",
      limitations: ["This is a sampled process footprint delta, not heap-dominator attribution."]
    }),
    summarizeMetric({
      id: "runtimeInitializationAgentHostOwnedMemoryDelta",
      label: "Agent Host owned/effective-memory change while initializing the Pi Runtime",
      unit: "MiB",
      samples: samples.runtimeInitializationAgentHostOwnedMemoryDelta,
      evidenceLevel: "packaged",
      method: "Per-sample Agent Host owned/effective memory after Runtime initialization minus connected unloaded state",
      limitations: ["This includes Pi SDK, models, resources, extensions, and Session initialization."]
    }),
    summarizeMetric({
      id: "realPiSessionProjection",
      label: "Official 1,000-message Pi session restore to bounded usable projection",
      unit: "ms",
      samples: samples.realPiSessionProjection,
      budget: 1_500,
      evidenceLevel: "packaged",
      method: `SessionManager.appendMessage JSONL fixture; Workspace menu import action; native dialog bridge; managed copy; Pi SDK restore; validated bounded recent ${defaultMessagePageSize}-message page, older-page affordance, visible fixture content, and composer paint`,
      limitations: ["The synthetic session contains user and assistant text messages but no images, tool results, compaction, or branches."]
    }),
    summarizeMetric({
      id: "restoredSessionWorkingSet",
      label: "Main + renderer + Agent Host working set after 1,000-message restore",
      unit: "MiB",
      samples: samples.restoredSessionMemory,
      evidenceLevel: "packaged",
      method: "Three-process working-set sum after the official 1,000-message Pi JSONL is fully projected",
      limitations: ["Summed RSS can double-count shared pages."]
    }),
    summarizeMetric({
      id: "restoredSessionMainWorkingSet",
      label: "Electron Main working set after the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.restoredSessionMainMemory,
      evidenceLevel: "packaged",
      method: "Main process component of restoredSessionWorkingSet"
    }),
    summarizeMetric({
      id: "restoredSessionRendererWorkingSet",
      label: "Renderer working set after the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.restoredSessionRendererMemory,
      evidenceLevel: "packaged",
      method: "Renderer process component of restoredSessionWorkingSet"
    }),
    summarizeMetric({
      id: "restoredSessionAgentHostWorkingSet",
      label: "Agent Host working set after the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.restoredSessionAgentHostMemory,
      evidenceLevel: "packaged",
      method: "Agent Host component of restoredSessionWorkingSet"
    }),
    summarizeMetric({
      id: "restoredSessionOwnedMemory",
      label: "Main + renderer + Agent Host owned/effective memory after 1,000-message restore",
      unit: "MiB",
      samples: samples.restoredSessionOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; three-process sum after the official 1,000-message Pi JSONL is projected`,
      limitations: ownedMemoryLimitations
    }),
    summarizeMetric({
      id: "restoredSessionMainOwnedMemory",
      label: "Electron Main owned/effective memory after the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.restoredSessionMainOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; Main process component`
    }),
    summarizeMetric({
      id: "restoredSessionRendererOwnedMemory",
      label: "Renderer owned/effective memory after the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.restoredSessionRendererOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; renderer process component`
    }),
    summarizeMetric({
      id: "restoredSessionAgentHostOwnedMemory",
      label: "Agent Host owned/effective memory after the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.restoredSessionAgentHostOwnedMemory,
      evidenceLevel: "packaged",
      method: `${ownedMemoryMethod}; node utility process component`
    }),
    summarizeMetric({
      id: "sessionRestoreWorkingSetDelta",
      label: "Aggregate working-set change for the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.sessionRestoreWorkingSetDelta,
      evidenceLevel: "packaged",
      method: "Per-sample restored Session aggregate minus the initialized empty Runtime aggregate",
      limitations: ["This is a sampled RSS delta, not retained-heap attribution.", "Summed RSS can double-count shared pages."]
    }),
    summarizeMetric({
      id: "sessionRestoreAgentHostDelta",
      label: "Agent Host working-set change for the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.sessionRestoreAgentHostDelta,
      evidenceLevel: "packaged",
      method: "Per-sample Agent Host RSS after restore minus Agent Host RSS for the initialized empty Runtime",
      limitations: ["The synthetic Session has no tools, images, compaction, branches, or provider turn."]
    }),
    summarizeMetric({
      id: "sessionRestoreOwnedMemoryDelta",
      label: "Aggregate owned/effective-memory change for the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.sessionRestoreOwnedMemoryDelta,
      evidenceLevel: "packaged",
      method: "Per-sample restored Session owned/effective sum minus initialized empty Runtime sum",
      limitations: ["This is a sampled process footprint delta, not heap-dominator attribution."]
    }),
    summarizeMetric({
      id: "sessionRestoreAgentHostOwnedMemoryDelta",
      label: "Agent Host owned/effective-memory change for the 1,000-message Session restore",
      unit: "MiB",
      samples: samples.sessionRestoreAgentHostOwnedMemoryDelta,
      evidenceLevel: "packaged",
      method: "Per-sample Agent Host owned/effective memory after restore minus initialized empty Runtime state",
      limitations: ["The synthetic Session has no tools, images, compaction, branches, or provider turn."]
    }),
    summarizeMetric({
      id: "agentHostRecovery",
      label: "Agent Host crash to recovered active Pi session",
      unit: "ms",
      samples: samples.recovery,
      budget: 3_000,
      evidenceLevel: "packaged",
      method: "Initialize an isolated Pi session, terminate node utility process, then wait for failure notice, replacement PID, and Pi SDK ready state"
    }),
    summarizeMetric({
      id: "packagedLongCodeHighlight",
      label: "Packaged app:// TypeScript code highlight",
      unit: "ms",
      samples: samples.packagedCodeHighlight,
      evidenceLevel: "packaged",
      method: "Official Pi JSONL with 500 TypeScript lines; app:// renderer, CSP, same-origin module worker, Shiki WASM, grammar, and bounded virtual line window",
      limitations: ["Informational; browser-tier stress coverage uses 2,000 cold and 1,800 warm lines."]
    }),
    summarizeMetric({
      id: "activeExtensionCommandClose",
      label: "Packaged close with active controlled Extension command",
      unit: "ms",
      samples: samples.activeExtensionCommandClose,
      budget: 5_000,
      evidenceLevel: "packaged",
      method: "Run a controlled non-cancellable Pi Extension command with a child process, close the app, then verify session_shutdown(reason=quit) and child/Agent Host exit",
      limitations: ["Exercises Pi Runtime disposal and process cleanup without a Provider, but does not prove a provider-driven Pi Tool invocation."]
    }),
    summarizeMetric({
      id: "normalClose",
      label: "Normal packaged application close",
      unit: "ms",
      samples: samples.close,
      evidenceLevel: "packaged",
      method: "Playwright ElectronApplication.close without an active Pi tool",
      limitations: ["Does not satisfy the active-tool close budget."]
    })
  ];
  const report = await createReport({
    root,
    suite: "electron",
    metrics,
    unverified: [
      { id: "powerCycleColdLaunch", reason: "Requires an OS-level cold-cache procedure outside the automated harness." },
      { id: "activeToolClose", reason: "The controlled Extension command is measured separately; a provider-driven real Pi Tool invocation remains unverified." },
      { id: "providerTurnMemory", reason: "Requires controlled real provider turns with representative tool and transcript payloads." }
    ]
  });
  report.rendererResources = rendererResources;
  await writeReport(outputPath, report);
  printReport(outputPath, report);
  printRendererResourceAttribution(rendererResources);
  enforceReport(report);
}
