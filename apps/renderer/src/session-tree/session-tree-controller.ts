import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  useSessionTreeStore,
  type SessionTreeAuthority
} from "./session-tree-store.js";

let refreshFlight: Promise<void> | undefined;

export function refreshSessionTree(authority: SessionTreeAuthority): Promise<void> {
  if (!useSessionTreeStore.getState().markChanged(authority)) return Promise.resolve();
  return ensureRefreshFlight();
}

function ensureRefreshFlight(): Promise<void> {
  if (refreshFlight) return refreshFlight;
  const promise = drainRefreshes().finally(() => {
    if (refreshFlight !== promise) return;
    refreshFlight = undefined;
    if (useSessionTreeStore.getState().needsRefresh(currentCanonicalAuthority())) {
      void ensureRefreshFlight();
    }
  });
  refreshFlight = promise;
  return promise;
}

async function drainRefreshes(): Promise<void> {
  while (true) {
    const store = useSessionTreeStore.getState();
    const target = store.beginRefresh(currentCanonicalAuthority());
    if (!target) return;
    try {
      const tree = await agentConnectionController.request("session.tree", {});
      const result = store.finishRefresh(target, tree);
      if (result !== "superseded") return;
    } catch (error) {
      if (!store.failRefresh(target)) return;
      publishNotification({
        level: "warning",
        title: "无法刷新会话树",
        message: errorMessage(error)
      });
      if (!store.needsRefresh(currentCanonicalAuthority())) return;
    }
  }
}

function currentCanonicalAuthority() {
  return useSessionProjectionStore.getState().authority;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
