import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  currentRendererSessionAuthority,
  type RendererSessionAuthorityState
} from "../session/session-authority.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  useWorkspaceChangesStore,
  type WorkspaceChangesTarget
} from "./workspace-changes-store.js";

let refreshFlight: Promise<void> | undefined;

export function activateRendererSessionChanges(state: RendererSessionAuthorityState): boolean {
  const authority = currentRendererSessionAuthority(state);
  if (!authority) {
    useWorkspaceChangesStore.getState().reset("stale");
    return false;
  }
  useWorkspaceChangesStore.getState().beginSession(authority);
  return true;
}

export function refreshWorkspaceChanges(): Promise<void> {
  const store = useWorkspaceChangesStore.getState();
  if (store.status === "loading" && refreshFlight) return refreshFlight;
  const target = store.beginRefresh(useSessionProjectionStore.getState().authority);
  if (!target) return Promise.resolve();

  const promise = executeRefresh(target).finally(() => {
    if (refreshFlight === promise) refreshFlight = undefined;
  });
  refreshFlight = promise;
  return promise;
}

async function executeRefresh(target: WorkspaceChangesTarget): Promise<void> {
  const store = useWorkspaceChangesStore.getState();
  try {
    const projection = await agentConnectionController.request("workspace.changes", {});
    if (projection.sessionId !== target.sessionId) {
      throw new Error("Workspace changes response belongs to a different Session.");
    }
    store.finishRefresh(target, projection);
  } catch (error) {
    if (!store.failRefresh(target)) return;
    publishNotification({
      level: "warning",
      title: "无法加载本会话修改记录",
      message: errorMessage(error)
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
