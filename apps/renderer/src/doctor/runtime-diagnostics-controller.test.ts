import type { DoctorReport } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useShellStore } from "../shell/shell-store.js";
import { doctorStore } from "./doctor-store.js";
import {
  runRuntimeDoctor,
  saveRuntimeDiagnostics
} from "./runtime-diagnostics-controller.js";

describe("runtime diagnostics controller", () => {
  let saveDiagnostics: ReturnType<typeof vi.fn>;
  let getRecoverySnapshot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doctorStore.setState(doctorStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useShellStore.setState(useShellStore.getInitialState(), true);
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app-1",
      hostInstanceId: "host-9",
      hostEpoch: 9,
      sdkVersion: "0.81.1",
      eventSequence: 0
    });
    saveDiagnostics = vi.fn().mockResolvedValue("/tmp/pi67-diagnostics.json");
    getRecoverySnapshot = vi.fn().mockResolvedValue(recoverySnapshot());
    vi.stubGlobal("window", {
      pi67: {
        system: {
          getRecoverySnapshot,
          saveDiagnostics
        }
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    doctorStore.setState(doctorStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useShellStore.setState(useShellStore.getInitialState(), true);
  });

  it("opens Doctor and installs a completed report", async () => {
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => (
      type === "doctor.run" ? doctorReport() : runtimeDiagnostics()
    ) as never);

    await runRuntimeDoctor();

    expect(useShellStore.getState().doctorDialogOpen).toBe(true);
    expect(doctorStore.getState()).toMatchObject({
      running: false,
      error: undefined,
      report: doctorReport(),
      recovery: recoverySnapshot(),
      diagnostics: runtimeDiagnostics(),
      renderer: rendererDiagnostics()
    });
  });

  it("keeps Doctor retryable and publishes a visible failure", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("Doctor unavailable"));

    await runRuntimeDoctor();

    expect(useShellStore.getState().doctorDialogOpen).toBe(true);
    expect(doctorStore.getState()).toMatchObject({
      running: false,
      error: "Doctor unavailable"
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "Agent Host 诊断未完成",
      message: "Doctor unavailable"
    });
  });

  it("saves a redacted report through the system bridge", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({ safe: true } as never);

    await saveRuntimeDiagnostics();

    expect(request).toHaveBeenCalledWith(
      "diagnostics.collect",
      {},
      [],
      { ackTimeoutMs: 3_000 }
    );
    expect(saveDiagnostics).toHaveBeenCalledWith({
      runtimeCollection: { status: "available" },
      runtime: { safe: true },
      renderer: rendererDiagnostics()
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "info",
      title: "脱敏诊断已保存"
    });
  });

  it("keeps Desktop recovery results when Host diagnostics fail", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("Host unavailable"));

    await runRuntimeDoctor();

    expect(doctorStore.getState()).toMatchObject({
      recovery: recoverySnapshot(),
      recoveryError: undefined,
      running: false,
      error: "Host unavailable"
    });
  });

  it("keeps Host results when Desktop recovery inspection fails", async () => {
    getRecoverySnapshot.mockRejectedValue(new Error("Desktop state unavailable"));
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => (
      type === "doctor.run" ? doctorReport() : runtimeDiagnostics()
    ) as never);

    await runRuntimeDoctor();

    expect(doctorStore.getState()).toMatchObject({
      report: doctorReport(),
      diagnostics: runtimeDiagnostics(),
      recovery: undefined,
      recoveryError: "Desktop state unavailable",
      running: false
    });
  });

  it("exports Main-owned diagnostics when Host acknowledgement times out", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new ProtocolRequestError({
      code: "REQUEST_TIMEOUT",
      message: "Agent request acknowledgement timed out: diagnostics.collect",
      recoverable: true
    }));

    await saveRuntimeDiagnostics();

    expect(saveDiagnostics).toHaveBeenCalledWith({
      runtimeCollection: {
        status: "unavailable",
        failure: "acknowledgement-timeout"
      },
      renderer: rendererDiagnostics()
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "info",
      title: "脱敏诊断已保存",
      message: "Agent Host 当前不可用；诊断包已保留 Main、配置可读性与恢复状态。"
    });
  });

  it("turns Main export failures into a bounded notification", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("Port closed"));
    saveDiagnostics.mockRejectedValue(new Error("Save failed"));

    await saveRuntimeDiagnostics();

    expect(saveDiagnostics).toHaveBeenCalledWith({
      runtimeCollection: {
        status: "unavailable",
        failure: "unknown"
      },
      renderer: rendererDiagnostics()
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法导出脱敏诊断",
      message: "Save failed"
    });
  });
});

function doctorReport(): DoctorReport {
  return {
    generatedAt: 1,
    checks: [{ id: "node", label: "Node", status: "pass", detail: "ok" }]
  };
}

function recoverySnapshot() {
  return {
    generatedAt: 2,
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

function rendererDiagnostics() {
  return {
    activeRequestCount: 0,
    sampleCount: 0,
    slowAcknowledgementCount: 0,
    slowThresholdMs: 2_000
  };
}

function runtimeDiagnostics() {
  return {
    generatedAt: 3,
    application: "π",
    piSdkVersion: "0.81.1",
    platform: "darwin",
    architecture: "arm64",
    node: "24.18.0",
    sessionConfigured: false,
    sessionFileConfigured: false,
    extensionCount: 0,
    extensionErrors: [],
    toolExecutionReceiptFailureCount: 0
  };
}
