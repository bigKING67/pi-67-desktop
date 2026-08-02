import { publishNotification } from "../notifications/notification-store.js";
import {
  hasUnpersistedWorkspaceDrafts,
  serializeWorkspaceFileState,
  workspaceFileStore
} from "./workspace-file-store.js";

let initialized = false;
let suppressPersistence = false;
let persistTimer: number | undefined;
let persistPromise: Promise<void> = Promise.resolve();

export async function initializeWorkspaceFilePersistence(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const snapshot = await window.pi67.system.loadWorkspaceFileState();
    suppressPersistence = true;
    workspaceFileStore.getState().hydrate(snapshot);
    suppressPersistence = false;
    if (snapshot.recovery === "corrupt-reset") {
      publishNotification({
        level: "warning",
        title: "文件标签状态已重置",
        message: "保存的文件标签状态损坏，工作区和 Pi 会话未受影响。"
      });
    } else if (snapshot.recovery === "draft-decrypt-failed") {
      publishNotification({
        level: "warning",
        title: "部分文件草稿无法恢复",
        message: "无法解密的草稿已隔离，文件标签仍可重新打开。"
      });
    }
  } catch (error) {
    workspaceFileStore.getState().setPersistenceError(errorMessage(error));
  }

  workspaceFileStore.subscribe(() => {
    if (!suppressPersistence) schedulePersistence();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void persistWorkspaceFileState();
  });
  window.addEventListener("beforeunload", (event) => {
    void persistWorkspaceFileState();
    if (!hasUnpersistedWorkspaceDrafts()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function persistWorkspaceFileState(): Promise<void> {
  if (persistTimer !== undefined) {
    window.clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  const state = serializeWorkspaceFileState();
  persistPromise = persistPromise.then(async () => {
    try {
      const snapshot = await window.pi67.system.updateWorkspaceFileState(state);
      suppressPersistence = true;
      workspaceFileStore.getState().setPersistenceResult(snapshot);
      suppressPersistence = false;
    } catch (error) {
      suppressPersistence = true;
      workspaceFileStore.getState().setPersistenceError(errorMessage(error));
      suppressPersistence = false;
    }
  });
  return persistPromise;
}

function schedulePersistence(): void {
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    void persistWorkspaceFileState();
  }, 500);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "文件标签状态无法保存。";
}
