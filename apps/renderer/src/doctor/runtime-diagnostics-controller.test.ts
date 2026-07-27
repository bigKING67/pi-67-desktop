import type { DoctorReport } from "@pi67/domain";
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
    vi.stubGlobal("window", {
      pi67: {
        system: {
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
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(doctorReport() as never);

    await runRuntimeDoctor();

    expect(useShellStore.getState().doctorDialogOpen).toBe(true);
    expect(doctorStore.getState()).toMatchObject({
      running: false,
      error: undefined,
      report: doctorReport()
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
      title: "Windows/macOS 运行环境检查失败",
      message: "Doctor unavailable"
    });
  });

  it("saves a redacted report through the system bridge", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({ safe: true } as never);

    await saveRuntimeDiagnostics();

    expect(saveDiagnostics).toHaveBeenCalledWith(JSON.stringify({ safe: true }, null, 2));
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "info",
      title: "脱敏诊断已保存"
    });
  });

  it("turns diagnostics transport failures into a bounded notification", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("Port closed"));

    await saveRuntimeDiagnostics();

    expect(saveDiagnostics).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法导出脱敏诊断",
      message: "Port closed"
    });
  });
});

function doctorReport(): DoctorReport {
  return {
    generatedAt: 1,
    checks: [{ id: "node", label: "Node", status: "pass", detail: "ok" }]
  };
}
