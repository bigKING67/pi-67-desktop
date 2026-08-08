import { publishNotification } from "../notifications/notification-store.js";
import { useRepositoryWorkingTreeStore } from "./repository-working-tree-store.js";

export async function refreshRepositoryWorkingTree(workspaceId: string): Promise<void> {
  const store = useRepositoryWorkingTreeStore.getState();
  const requestRevision = store.begin(workspaceId);
  try {
    const snapshot = await window.pi67.system.inspectRepositoryWorkingTree({ workspaceId });
    if (snapshot.workspaceId !== workspaceId) throw new Error("Repository snapshot belongs to another Workspace.");
    store.finish(workspaceId, requestRevision, snapshot);
  } catch (error) {
    const message = errorMessage(error);
    if (!store.fail(workspaceId, requestRevision, message)) return;
    publishNotification({ level: "warning", title: "无法读取工作区变更", message });
  }
}

export async function loadRepositoryChangeDetail(
  workspaceId: string,
  revision: number,
  changeId: string
): Promise<void> {
  const store = useRepositoryWorkingTreeStore.getState();
  if (!store.beginDetail(workspaceId, revision, changeId)) return;
  try {
    const detail = await window.pi67.system.readRepositoryChangeDetail({ workspaceId, revision, changeId });
    store.finishDetail(detail);
  } catch (error) {
    const message = errorMessage(error);
    if (!store.failDetail(workspaceId, revision, changeId, message)) return;
    publishNotification({ level: "warning", title: "无法读取 Git Diff", message });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "工作区变更暂时不可用。";
}
