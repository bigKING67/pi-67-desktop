import type { SessionResourceCatalogResult, WorkspaceTrust } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  useSessionProjectionStore
} from "../session/session-projection-store.js";
import type { SessionProjectionTarget } from "../session/session-projection-revisions.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import {
  acceptRendererSessionResponse,
  currentRendererSessionAuthority,
  type RendererSessionAuthority
} from "../session/session-authority.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

let trustRequestRevision = 0;

export function invalidateWorkspaceTrustRequests(): void {
  trustRequestRevision += 1;
}

export async function updateWorkspaceTrust(
  trust: WorkspaceTrust
): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  const state = get();
  if (state.trustUpdating || state.sessionTransitionPending) return;
  const authority = currentRendererSessionAuthority(state);
  if (!authority || state.runtime.phase === "starting" || state.runtime.phase === "recovering") {
    publishNotification({
      level: "warning",
      title: "Pi 会话尚未就绪",
      message: "完成加载后才能更新工作区信任。"
    });
    return;
  }
  if (!agentConnectionController.identity) throw new Error("Pi 运行服务尚未连接。");
  const projectionTarget = useSessionProjectionStore.getState().capture(authority);
  if (!projectionTarget) throw new Error("Renderer Session projection is not current.");
  const workspace = state.workspace;
  const requestRevision = ++trustRequestRevision;
  set({
    trustUpdating: true,
    sessionTransitionPending: true,
    runtime: { phase: "starting", detail: "正在加载 Pi 资源", recoverable: true }
  });
  try {
    const result = await agentConnectionController.request("workspace.setTrust", {
      trust,
      approvalMode: state.approvalMode
    });
    if (
      result.sessionId !== authority.sessionId
      || !isCurrent(get(), authority, workspace, requestRevision)
    ) return;
    if (!installTrustProjection(projectionTarget, result)) {
      publishNotification({
        level: "warning",
        title: "工作区信任结果已过期",
        message: "Pi 会话投影已在请求期间更新，请重试。"
      });
      return;
    }
    set((current) => isCurrent(current, authority, workspace, requestRevision)
      ? { trust, runtime: { phase: "ready", detail: "Pi 资源已就绪", recoverable: true } }
      : {});
  } catch (error) {
    if (isCurrent(get(), authority, workspace, requestRevision)) {
      const detail = errorMessage(error);
      publishNotification({ level: "error", title: "无法更新工作区信任", message: detail });
      set({
        runtime: {
          phase: "failed",
          detail: `无法更新工作区信任：${detail}`,
          recoverable: true
        }
      });
    }
  } finally {
    if (isCurrent(get(), authority, workspace, requestRevision)) {
      set({ trustUpdating: false, sessionTransitionPending: false });
    }
  }
}

function installTrustProjection(
  target: SessionProjectionTarget,
  result: SessionResourceCatalogResult
): boolean {
  return useSessionProjectionStore.getState().applyResourceCatalogResult(target, result);
}

function isCurrent(
  state: AppState,
  authority: RendererSessionAuthority,
  workspace: string | undefined,
  requestRevision: number
): boolean {
  return trustRequestRevision === requestRevision
    && state.workspace === workspace
    && acceptRendererSessionResponse(state, authority)
    && useSessionProjectionStore.getState().capture(authority) !== undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
