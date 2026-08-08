import type { OperationFreshness } from "@pi67/domain";
import type {
  DesktopRecoverySnapshot,
  RendererAcknowledgementDiagnostics,
  RuntimeDiagnostics
} from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import { buildRuntimeHealthChecks } from "./DoctorDialog.js";

describe("Doctor runtime health projection", () => {
  it("keeps healthy bounded runtime observations informational", () => {
    const rows = buildRuntimeHealthChecks(
      desktopRecovery(),
      runtimeDiagnostics(),
      rendererDiagnostics(),
      undefined
    );

    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.status === "pass")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("/private/");
  });

  it("surfaces poisoned, disposed, stalled, and slow states without raw identities", () => {
    const desktop = desktopRecovery();
    desktop.health.agentHost.phase = "failed";
    desktop.health.repository.gitRunner.disposed = true;
    desktop.health.promptStashImages.disposed = true;
    const runtime = runtimeDiagnostics();
    runtime.host!.scheduler.closedCount = 1;
    runtime.host!.operations.poisonedCount = 1;
    const renderer = rendererDiagnostics();
    renderer.lastAcknowledgementLatencyMs = 2_500;
    renderer.maxAcknowledgementLatencyMs = 2_500;
    renderer.slowAcknowledgementCount = 1;
    const freshness: OperationFreshness = {
      operationId: "must-not-cross",
      phase: "stalled",
      lastActivityAt: 1,
      lastHeartbeatAt: 2,
      observedAt: 3,
      reason: "heartbeat-overdue"
    };

    const states = Object.fromEntries(buildRuntimeHealthChecks(
      desktop,
      runtime,
      renderer,
      freshness
    ).map((row) => [row.id, row.status]));

    expect(states).toMatchObject({
      mainLifecycle: "fail",
      scheduler: "fail",
      operations: "fail",
      operationFreshness: "fail",
      rendererAcknowledgement: "warning",
      repositoryRuntime: "fail",
      promptStashRuntime: "fail"
    });
    expect(JSON.stringify(states)).not.toContain("must-not-cross");
  });
});

function desktopRecovery(): DesktopRecoverySnapshot {
  return {
    generatedAt: 1,
    previousRunExitStatus: "clean",
    workspaces: {
      total: 0,
      available: 0,
      missing: 0,
      identityChanged: 0,
      needsConfirmation: 0,
      unavailable: 0,
      trusted: 0,
      trustUnknown: 0,
      pathOnlyIdentity: 0
    },
    pendingSessionCreations: 0,
    attachmentStaging: { draftCount: 0, claimedCount: 0, invalidEntryCount: 0, truncated: false },
    health: {
      agentHost: {
        phase: "running",
        hostEpoch: 4,
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
    }
  };
}

function runtimeDiagnostics(): RuntimeDiagnostics {
  return {
    generatedAt: 1,
    application: "pi",
    piSdkVersion: "0.81.1",
    platform: "darwin",
    architecture: "arm64",
    node: "24.18.0",
    sessionConfigured: false,
    sessionFileConfigured: false,
    extensionCount: 0,
    extensionErrors: [],
    host: {
      hostEpoch: 4,
      taskCount: 0,
      liveRuntimeCount: 0,
      activeOperationCount: 0,
      scheduler: {
        taskCount: 0,
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
      writerLeases: { activeCount: 0, pendingCount: 0, compromised: false },
      workspaces: [],
      workspacesTruncated: false
    }
  };
}

function rendererDiagnostics(): RendererAcknowledgementDiagnostics {
  return {
    activeRequestCount: 0,
    sampleCount: 2,
    slowAcknowledgementCount: 0,
    slowThresholdMs: 2_000,
    lastAcknowledgementLatencyMs: 12,
    maxAcknowledgementLatencyMs: 18
  };
}
