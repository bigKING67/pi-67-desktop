import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useShellStore } from "../shell/shell-store.js";
import { doctorStore } from "./doctor-store.js";

export async function saveRuntimeDiagnostics(): Promise<void> {
  try {
    const diagnostics = await agentConnectionController.request("diagnostics.collect", {});
    const path = await window.pi67.system.saveDiagnostics(JSON.stringify(diagnostics, null, 2));
    if (path) publishNotification({ level: "info", title: "脱敏诊断已保存" });
  } catch (error) {
    publishNotification({
      level: "error",
      title: "无法导出脱敏诊断",
      message: errorMessage(error)
    });
  }
}

export async function runRuntimeDoctor(): Promise<void> {
  useShellStore.getState().setDoctorDialogOpen(true);
  doctorStore.getState().begin();
  try {
    await ensureAgentConnection();
    const report = await agentConnectionController.request("doctor.run", {});
    doctorStore.getState().complete(report);
  } catch (error) {
    const detail = errorMessage(error);
    doctorStore.getState().fail(detail);
    publishNotification({
      level: "error",
      title: messages.doctor.runtimeFailureTitle,
      message: detail
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
