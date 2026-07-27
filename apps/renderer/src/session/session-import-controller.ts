import { createMessageId } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import { operationFromSubmission } from "../app/app-state-projection.js";
import { applySettledSubmission } from "../app/operation-submission.js";
import { recoverMissingSessionImportBootstrap } from "../app/session-import-bootstrap-recovery.js";
import {
  captureSessionImportSubmission,
  classifySessionImportResponse,
  isSessionImportSubmissionCurrent
} from "../app/session-import-transition.js";
import { prepareRendererSessionTransaction } from "../app/renderer-session-transaction.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export async function importRendererSessionFile(): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (get().sessionTransitionPending) return;
  const path = await window.pi67.system.selectSessionFile();
  if (!path || get().sessionTransitionPending) return;
  prepareRendererSessionTransaction("session-import");
  set({ sessionTransitionPending: true });
  const target = captureSessionImportSubmission(get());
  if (!target) {
    set({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: "无法导入 Pi 会话：Pi 会话身份尚未就绪。",
        recoverable: true
      }
    });
    publishNotification({
      level: "error",
      title: "无法导入 Pi 会话",
      message: "Pi 会话身份尚未就绪。"
    });
    return;
  }
  try {
    const accepted = await agentConnectionController.request("session.import", {
      submissionId: createMessageId("session-import"),
      path
    });
    const disposition = classifySessionImportResponse(get(), target, accepted);
    if (disposition === "stale") return;
    if (disposition === "terminal") {
      applySettledSubmission(
        set,
        accepted,
        "session-import",
        "Pi 会话导入已结束",
        target.authority
      );
      return;
    }
    if (disposition === "bootstrap-required") {
      recoverMissingSessionImportBootstrap(get, set, target, accepted.operationId);
      return;
    }
    set({
      operation: operationFromSubmission(accepted, "session-import"),
      operationDetail: "正在导入 Pi 会话",
      operationProgress: undefined,
      runtime: { phase: "busy", detail: "正在导入 Pi 会话", recoverable: true }
    });
  } catch (error) {
    if (!isSessionImportSubmissionCurrent(get(), target)) return;
    const detail = errorMessage(error);
    set({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: `无法导入 Pi 会话：${detail}`,
        recoverable: true
      }
    });
    publishNotification({ level: "error", title: "无法导入 Pi 会话", message: detail });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
