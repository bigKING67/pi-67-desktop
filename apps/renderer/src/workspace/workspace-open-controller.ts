import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { invalidateProjectionRecoveryGeneration } from "../connection/projection-recovery-controller.js";
import { queryFirstSessionCatalog } from "../navigation/session-catalog-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  captureRendererSessionTransition,
  classifyRendererSessionBootstrap,
  type RendererSessionTransitionTarget
} from "../session/session-authority.js";
import { clearedTransientState } from "../app/app-state-projection.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import { prepareRendererSessionTransaction } from "../app/renderer-session-transaction.js";
import { invalidateWorkspaceTrustRequests } from "./workspace-trust-controller.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export async function openRendererWorkspace(): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (get().sessionTransitionPending) return;
  const workspace = await window.pi67.system.selectWorkspace();
  if (!workspace) return;
  invalidateProjectionRecoveryGeneration();
  invalidateWorkspaceTrustRequests();
  prepareRendererSessionTransaction("workspace-replaced");
  set({
    ...clearedTransientState(),
    workspace,
    trust: "unknown",
    trustUpdating: false,
    sessionTransitionPending: true,
    approvalMode: "guided",
    runtime: { phase: "starting", detail: "正在加载 Pi SDK", recoverable: true }
  });
  let target: RendererSessionTransitionTarget | undefined;
  try {
    await ensureAgentConnection();
    const transitionTarget = requireRendererSessionTransition(get());
    target = transitionTarget;
    const acknowledgement = await agentConnectionController.request("workspace.open", {
      cwd: workspace,
      trust: "unknown",
      approvalMode: "guided"
    });
    const disposition = classifyRendererSessionBootstrap(
      get(),
      transitionTarget,
      acknowledgement
    );
    if (disposition === "missing-bootstrap") {
      throw new Error("Agent Host 未发送 authoritative runtime.ready 事件。");
    }
    if (disposition === "committed" && get().workspace === workspace) {
      await queryFirstSessionCatalog();
    }
  } catch (error) {
    if (get().workspace !== workspace) return;
    if (target) {
      const disposition = classifyRendererSessionBootstrap(get(), target);
      if (disposition === "committed") {
        await queryFirstSessionCatalog();
        return;
      }
      if (disposition === "stale") return;
    }
    const detail = errorMessage(error);
    set({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: `无法打开工作区：${detail}`,
        recoverable: true
      }
    });
    publishNotification({ level: "error", title: "无法打开工作区", message: detail });
  }
}

function requireRendererSessionTransition(state: AppState): RendererSessionTransitionTarget {
  const target = captureRendererSessionTransition(state);
  if (!target) throw new Error("Agent Host 尚未连接。");
  return target;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
