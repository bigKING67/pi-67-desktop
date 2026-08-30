import {
  ProtocolRequestError,
  type RuntimeDiagnosticsCollectionFailure,
  type SupportDiagnosticsExportRequest,
  type SupportDiagnosticsUploadReceipt
} from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useShellStore } from "../shell/shell-store.js";
import { doctorStore } from "./doctor-store.js";

const DIAGNOSTIC_EXPORT_ACK_TIMEOUT_MS = 3_000;

export async function saveRuntimeDiagnostics(): Promise<void> {
  try {
    const request = await collectDiagnosticsExportRequest();
    const path = await window.pi67.system.saveDiagnostics(request);
    if (path) publishNotification({
      level: "info",
      title: "脱敏诊断已保存",
      ...(request.runtimeCollection.status === "unavailable"
        ? { message: messages.doctor.exportedWithoutRuntime }
        : {})
    });
  } catch (error) {
    publishNotification({
      level: "error",
      title: "无法导出脱敏诊断",
      message: errorMessage(error)
    });
  }
}

export async function uploadRuntimeDiagnostics(): Promise<SupportDiagnosticsUploadReceipt> {
  agentConnectionController.recordDiagnosticAction("diagnostics.upload", "started");
  try {
    const request = await collectDiagnosticsExportRequest();
    const receipt = await window.pi67.system.uploadDiagnostics(request);
    agentConnectionController.recordDiagnosticAction("diagnostics.upload", "completed");
    return receipt;
  } catch (error) {
    agentConnectionController.recordDiagnosticAction("diagnostics.upload", "failed");
    throw error;
  }
}

async function collectDiagnosticsExportRequest(): Promise<SupportDiagnosticsExportRequest> {
  try {
    const runtime = await agentConnectionController.request(
      "diagnostics.collect",
      {},
      [],
      { ackTimeoutMs: DIAGNOSTIC_EXPORT_ACK_TIMEOUT_MS }
    );
    return {
      runtimeCollection: { status: "available" },
      runtime,
      renderer: agentConnectionController.diagnostics()
    };
  } catch (error) {
    return {
      runtimeCollection: {
        status: "unavailable",
        failure: diagnosticsCollectionFailure(error)
      },
      renderer: agentConnectionController.diagnostics()
    };
  }
}

function diagnosticsCollectionFailure(error: unknown): RuntimeDiagnosticsCollectionFailure {
  if (!(error instanceof ProtocolRequestError)) return "unknown";
  if (error.code === "REQUEST_TIMEOUT") return "acknowledgement-timeout";
  if (error.code === "CONNECTION_CLOSED" || error.code === "RUNTIME_NOT_READY") return "connection-unavailable";
  if (error.code === "STALE_HOST_EPOCH") return "host-replaced";
  return "protocol-error";
}

export async function runRuntimeDoctor(): Promise<void> {
  useShellStore.getState().setDoctorDialogOpen(true);
  doctorStore.getState().begin();
  const [hostResult, recoveryResult] = await Promise.allSettled([
    collectHostDiagnostics(),
    window.pi67.system.getRecoverySnapshot()
  ]);
  doctorStore.getState().completeRenderer(agentConnectionController.diagnostics());

  if (recoveryResult.status === "fulfilled") {
    doctorStore.getState().completeRecovery(recoveryResult.value);
  } else {
    const detail = errorMessage(recoveryResult.reason);
    doctorStore.getState().failRecovery(detail);
    publishNotification({
      level: "error",
      title: messages.doctor.recoveryFailureTitle,
      message: detail
    });
  }

  if (hostResult.status === "fulfilled") {
    const failures: string[] = [];
    if (hostResult.value.report.status === "fulfilled") {
      doctorStore.getState().complete(hostResult.value.report.value);
    } else if (!doctorStore.getState().report) {
      failures.push(errorMessage(hostResult.value.report.reason));
    }
    if (hostResult.value.diagnostics.status === "fulfilled") {
      doctorStore.getState().completeDiagnostics(hostResult.value.diagnostics.value);
    } else {
      failures.push(errorMessage(hostResult.value.diagnostics.reason));
    }
    if (failures.length === 0) doctorStore.getState().finish();
    else failRuntimeDoctor([...new Set(failures)].join("；"));
  } else {
    failRuntimeDoctor(errorMessage(hostResult.reason));
  }
}

async function collectHostDiagnostics() {
  await ensureAgentConnection();
  const [report, diagnostics] = await Promise.allSettled([
    agentConnectionController.request("doctor.run", {}),
    agentConnectionController.request("diagnostics.collect", {})
  ]);
  return { report, diagnostics };
}

function failRuntimeDoctor(detail: string): void {
  doctorStore.getState().fail(detail);
  publishNotification({
    level: "error",
    title: messages.doctor.runtimeFailureTitle,
    message: detail
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
