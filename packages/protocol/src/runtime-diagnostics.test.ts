import { describe, expect, it } from "vitest";
import {
  isRuntimeDiagnostics,
  isSupportDiagnosticsExportRequest
} from "./runtime-diagnostics.js";

const diagnostics = {
  generatedAt: 1,
  application: "π",
  piSdkVersion: "0.81.1",
  platform: "darwin",
  architecture: "arm64",
  node: "24.18.0",
  workspace: {
    pathHash: "a".repeat(64),
    pathKind: "posix"
  },
  sessionConfigured: true,
  sessionFileConfigured: true,
  model: "openai/gpt-test",
  extensionCount: 0,
  extensionErrors: [],
  toolExecutionReceiptFailureCount: 0,
  host: {
    hostEpoch: 4,
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
      registryCount: 1,
      acceptingCount: 0,
      activeCount: 0,
      terminatingCount: 0,
      poisonedCount: 0,
      heartbeatTrackedCount: 0,
      maxQuietForMs: 0
    },
    writerLeases: { activeCount: 1, pendingCount: 0, compromised: false },
    initializationReceipts: {
      receipts: [{
        outcome: "completed",
        stages: [{
          stage: "load-session-resources",
          outcome: "completed",
          durationMs: 123
        }],
        stagesTruncated: false
      }],
      receiptsTruncated: false
    },
    causality: {
      incidents: [{
        sequence: 1,
        at: 100,
        layer: "agent-host",
        phase: "response-post",
        outcome: "failed",
        command: "asset.read",
        errorClass: "DataCloneError",
        reason: "response-post-failed",
        connectionSequence: 2,
        hostEpoch: 4,
        binaryBytes: 512
      }],
      incidentsDroppedCount: 0
    },
    workspaces: [],
    workspacesTruncated: false
  }
} as const;

const renderer = {
  activeRequestCount: 0,
  sampleCount: 3,
  slowAcknowledgementCount: 0,
  slowThresholdMs: 2_000,
  lastAcknowledgementLatencyMs: 12,
  maxAcknowledgementLatencyMs: 18,
  connectionGeneration: 4,
  teardownCount: 1,
  futureGenerationWaitCount: 1,
  futureGenerationWaitTimeoutCount: 0,
  priorGenerationTeardownIgnoredCount: 1,
  consecutiveUnstableConnectionCount: 1,
  automaticReplacementSuppressedCount: 0,
  lastTeardownAt: 123,
  lastTeardownCode: "CONNECTION_CLOSED",
  lastTeardownReason: "port-closed",
  causality: {
    actions: [{ sequence: 1, at: 100, action: "task.resume", stage: "started" }],
    actionsDroppedCount: 0,
    incidents: [{
      sequence: 2,
      at: 101,
      layer: "renderer",
      phase: "request",
      outcome: "failed",
      command: "asset.read",
      errorClass: "ProtocolRequestError",
      reason: "request-failed",
      connectionGeneration: 4,
      hostEpoch: 4
    }],
    incidentsDroppedCount: 0
  }
} as const;

describe("runtime diagnostics boundary", () => {
  it("accepts the bounded redacted diagnostics projection", () => {
    expect(isRuntimeDiagnostics(diagnostics)).toBe(true);
  });

  it("rejects raw paths, unknown fields, and malformed hashes", () => {
    expect(isRuntimeDiagnostics({ ...diagnostics, cwd: "/private/workspace" })).toBe(false);
    expect(isRuntimeDiagnostics({
      ...diagnostics,
      workspace: { pathHash: "short", pathKind: "posix" }
    })).toBe(false);
    expect(isRuntimeDiagnostics({
      ...diagnostics,
      host: {
        ...diagnostics.host,
        causality: {
          incidents: [{
            ...diagnostics.host.causality.incidents[0],
            message: "private raw error"
          }],
          incidentsDroppedCount: 0
        }
      }
    })).toBe(false);
    expect(isRuntimeDiagnostics({
      ...diagnostics,
      extensionErrors: [{ sourceHash: "b".repeat(64), errorClass: "contains spaces" }]
    })).toBe(false);
  });

  it("accepts only correlated available or unavailable export requests", () => {
    expect(isSupportDiagnosticsExportRequest({
      runtimeCollection: { status: "available" },
      runtime: diagnostics,
      renderer
    })).toBe(true);
    expect(isSupportDiagnosticsExportRequest({
      runtimeCollection: {
        status: "unavailable",
        failure: "acknowledgement-timeout"
      },
      renderer
    })).toBe(true);

    expect(isSupportDiagnosticsExportRequest({
      runtimeCollection: { status: "available" }
    })).toBe(false);
    expect(isSupportDiagnosticsExportRequest({
      runtimeCollection: {
        status: "unavailable",
        failure: "acknowledgement-timeout"
      },
      runtime: diagnostics,
      renderer
    })).toBe(false);
    expect(isSupportDiagnosticsExportRequest({
      runtimeCollection: {
        status: "unavailable",
        failure: "raw-message-must-not-cross"
      },
      renderer
    })).toBe(false);
    expect(isSupportDiagnosticsExportRequest({
      runtimeCollection: {
        status: "unavailable",
        failure: "connection-unavailable"
      },
      renderer: { ...renderer, lastTeardownReason: "raw-private-reason" }
    })).toBe(false);
  });
});
