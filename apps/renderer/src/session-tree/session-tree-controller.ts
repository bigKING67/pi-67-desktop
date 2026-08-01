import { ProtocolRequestError } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
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
  let transientBusyRetries = 0;
  while (true) {
    const store = useSessionTreeStore.getState();
    const target = store.beginRefresh(currentCanonicalAuthority());
    if (!target) return;
    const context = taskContextForTarget(target);
    if (!context) {
      store.failRefresh(target);
      return;
    }
    try {
      const tree = await agentConnectionController.request(
        "session.tree",
        {},
        [],
        { context }
      );
      const result = store.finishRefresh(target, tree);
      if (result !== "superseded") return;
      transientBusyRetries = 0;
    } catch (error) {
      if (
        isTransientBusy(error)
        && transientBusyRetries < 1
        && store.deferRefresh(target)
      ) {
        transientBusyRetries += 1;
        await waitForRetry(error.retryAfterMs);
        continue;
      }
      if (!store.failRefresh(target)) return;
      publishNotification({
        level: "warning",
        title: "无法刷新会话树",
        message: sessionTreeErrorMessage(error)
      });
      if (!store.needsRefresh(currentCanonicalAuthority())) return;
    }
  }
}

function currentCanonicalAuthority() {
  return useSessionProjectionStore.getState().authority;
}

function taskContextForTarget(target: SessionTreeAuthority) {
  const task = Object.values(rendererWorkbenchStore.getState().tasks).find((candidate) => (
    candidate.sessionId === target.sessionId
    && candidate.sessionGeneration === target.sessionGeneration
  ));
  return task ? workbenchProtocolContextForTask(task) : undefined;
}

function isTransientBusy(error: unknown): error is ProtocolRequestError {
  return error instanceof ProtocolRequestError
    && error.code === "BUSY"
    && error.recoverable;
}

function waitForRetry(retryAfterMs: number | undefined): Promise<void> {
  const delayMs = Math.min(Math.max(retryAfterMs ?? 100, 0), 1_000);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function sessionTreeErrorMessage(error: unknown): string {
  if (isTransientBusy(error)) {
    return "Pi 正在完成其他会话操作，会话树将在下次状态变化时重新同步。";
  }
  return error instanceof Error ? error.message : "未知错误";
}
