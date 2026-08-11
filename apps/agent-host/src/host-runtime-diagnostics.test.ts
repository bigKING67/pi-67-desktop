import type { AgentRuntime } from "@pi67/pi-runtime";
import { describe, expect, it, vi } from "vitest";
import { collectHostRuntimeDiagnostics } from "./host-runtime-diagnostics.js";

describe("Host runtime diagnostics", () => {
  it("aggregates bounded scheduler and operation counts without Task identities", async () => {
    const runtime = {
      collectDiagnostics: vi.fn(async () => ({
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
        toolExecutionReceiptFailureCount: 0
      }))
    } as unknown as AgentRuntime;
    const taskStates = [{
      record: { closed: false, runtime: {} },
      scheduler: {
        diagnostics: () => ({
          queryActive: 2,
          controlQueued: 3,
          controlRunning: true,
          promptQueued: 4,
          promptRunning: true,
          turnAdmission: false,
          closed: false
        })
      },
      operations: {
        hasActive: () => true,
        diagnostics: () => ({
          accepting: false,
          active: true,
          terminating: false,
          poisoned: false,
          heartbeat: { active: true, lastActivityAt: 1_000, quietForMs: 9_000 }
        })
      }
    }];

    const diagnostics = await collectHostRuntimeDiagnostics({
      runtime,
      hostEpoch: 8,
      taskStates,
      workspaceRecords: [],
      writerLeases: {
        diagnostics: () => ({ activeCount: 1, pendingCount: 0, compromised: false })
      }
    } as unknown as Parameters<typeof collectHostRuntimeDiagnostics>[0]);

    expect(diagnostics.host).toMatchObject({
      hostEpoch: 8,
      taskCount: 1,
      liveRuntimeCount: 1,
      activeOperationCount: 1,
      scheduler: {
        taskCount: 1,
        activeQueryCount: 2,
        queuedControlCount: 3,
        runningControlCount: 1,
        queuedPromptCount: 4,
        runningPromptCount: 1,
        turnAdmissionCount: 0,
        closedCount: 0
      },
      operations: {
        registryCount: 1,
        acceptingCount: 0,
        activeCount: 1,
        terminatingCount: 0,
        poisonedCount: 0,
        heartbeatTrackedCount: 1,
        maxQuietForMs: 9_000
      }
    });
    expect(JSON.stringify(diagnostics)).not.toContain("task-");
  });
});
