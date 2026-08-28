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
  maxAcknowledgementLatencyMs: 18
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
  });
});
