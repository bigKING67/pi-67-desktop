import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import {
  runIncrementalSessionTransition,
  runSessionBootstrapTransition
} from "../app/session-transition.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export async function createRendererSession(): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (!get().workspace) return;
  await runSessionBootstrapTransition(get, set, {
    detail: "正在创建 Pi 新会话",
    refreshSessionCatalog: true,
    onError: (error) => reportSessionError(error, set, "无法创建 Pi 会话"),
    request: () => agentConnectionController.request("session.create", {})
  });
}

export async function openRendererSession(
  path: string
): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  const workspace = get().workspace;
  await runSessionBootstrapTransition(get, set, {
    detail: "正在恢复 Pi 会话",
    refreshSessionCatalog: true,
    onError: (error) => reportSessionError(error, set, "无法恢复 Pi 会话"),
    request: () => agentConnectionController.request("session.open", {
      path,
      ...(workspace ? { cwdOverride: workspace } : {})
    })
  });
}

export async function rollbackRendererSession(entryId: string): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  await runIncrementalSessionTransition(get, set, {
    detail: "正在回退 Pi 会话",
    readyDetail: "Pi 会话已回退",
    refreshChanges: true,
    onError: (error) => reportSessionError(error, set, "无法回退 Pi 会话"),
    request: () => agentConnectionController.request("session.rollback", { entryId })
  });
}

function reportSessionError(error: unknown, set: StoreSet, title: string): void {
  const detail = error instanceof Error ? error.message : "未知错误";
  publishNotification({ level: "error", title, message: detail });
  set({ runtime: { phase: "failed", detail: `${title}：${detail}`, recoverable: true } });
}
