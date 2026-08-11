import type { DesktopRuntimeHealthDiagnostics } from "../../packages/domain/src/index.js";
import type { RuntimeDiagnostics } from "../../packages/protocol/src/index.js";

export const MOCK_DESKTOP_RUNTIME_HEALTH = {
  agentHost: {
    phase: "running",
    hostEpoch: 1,
    restartCount: 0,
    portHandoffCount: 1,
    poisonedRuntimeReplacementCount: 0,
    poisonedRuntimeReplacementPending: false
  },
  repository: {
    mutationScheduler: {
      queuedCount: 0,
      runningCount: 0,
      activeRepositoryCount: 0,
      fencedRepositoryCount: 0,
      disposed: false
    },
    gitRunner: { activeProcessCount: 0, disposed: false },
    workingTree: { cachedSnapshotCount: 0, disposed: false }
  },
  promptStashImages: { disposed: false }
} satisfies DesktopRuntimeHealthDiagnostics;

export const MOCK_RUNTIME_DIAGNOSTICS = {
  generatedAt: 0,
  application: "\u03c0",
  piSdkVersion: "0.81.1",
  platform: "darwin",
  architecture: "arm64",
  node: "24.18.0",
  workspace: { pathHash: "a".repeat(64), pathKind: "posix" },
  sessionConfigured: true,
  sessionFileConfigured: true,
  model: "openai/gpt-test",
  extensionCount: 0,
  extensionErrors: [],
  toolExecutionReceiptFailureCount: 0,
  host: {
    hostEpoch: 0,
    taskCount: 1,
    liveRuntimeCount: 1,
    activeOperationCount: 0,
    scheduler: {
      taskCount: 1,
      activeQueryCount: 0,
      queuedControlCount: 0,
      runningControlCount: 0,
      queuedPromptCount: 0,
      runningPromptCount: 0,
      turnAdmissionCount: 0,
      closedCount: 0
    },
    operations: {
      registryCount: 0,
      acceptingCount: 0,
      activeCount: 0,
      terminatingCount: 0,
      poisonedCount: 0,
      heartbeatTrackedCount: 0,
      maxQuietForMs: 0
    },
    writerLeases: { activeCount: 1, pendingCount: 0, compromised: false },
    workspaces: [],
    workspacesTruncated: false
  }
} satisfies RuntimeDiagnostics;
