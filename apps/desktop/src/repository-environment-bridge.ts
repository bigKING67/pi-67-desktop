import { ipcMain } from "electron";
import {
  isRepositoryChangeDetail,
  isRepositoryEnvironmentSnapshot,
  isRepositoryWorkingTreeSnapshot,
  parseRepositoryChangeDetailRequest,
  parseRepositoryEnvironmentInspectionRequest,
  parseRepositoryWorkingTreeInspectionRequest,
  type RepositoryChangeDetail,
  type RepositoryEnvironmentSnapshot,
  type RepositoryWorkingTreeSnapshot
} from "@pi67/protocol";

export interface RepositoryEnvironmentInspectionBridge {
  inspect(value: { workspaceId: string }): Promise<RepositoryEnvironmentSnapshot>;
  removeWorkspace(workspaceId: string): Promise<void>;
  dispose(): void;
}

export interface RepositoryWorkingTreeBridge {
  inspect(value: { workspaceId: string }): Promise<RepositoryWorkingTreeSnapshot>;
  detail(value: { workspaceId: string; revision: number; changeId: string }): Promise<RepositoryChangeDetail>;
  removeWorkspace(workspaceId: string): void | Promise<void>;
  diagnostics(): { cachedSnapshotCount: number; disposed: boolean };
  dispose(): void;
}

export function registerRepositoryEnvironmentBridge(
  inspection: RepositoryEnvironmentInspectionBridge,
  workingTree: RepositoryWorkingTreeBridge
): void {
  ipcMain.handle("pi67:repository-environment-inspect", async (_event, value: unknown) => {
    const request = parseRepositoryEnvironmentInspectionRequest(value);
    if (!request) throw new Error("Repository environment inspection request is invalid.");
    const snapshot = await inspection.inspect(request);
    if (!isRepositoryEnvironmentSnapshot(snapshot)) {
      throw new Error("Repository environment inspection response is invalid.");
    }
    return snapshot;
  });
  ipcMain.handle("pi67:repository-working-tree-inspect", async (_event, value: unknown) => {
    const request = parseRepositoryWorkingTreeInspectionRequest(value);
    if (!request) throw new Error("Invalid repository working tree inspection request.");
    const snapshot = await workingTree.inspect(request);
    if (!isRepositoryWorkingTreeSnapshot(snapshot)) throw new Error("Invalid repository working tree snapshot.");
    return snapshot;
  });
  ipcMain.handle("pi67:repository-change-detail", async (_event, value: unknown) => {
    const request = parseRepositoryChangeDetailRequest(value);
    if (!request) throw new Error("Invalid repository change detail request.");
    const detail = await workingTree.detail(request);
    if (!isRepositoryChangeDetail(detail)) throw new Error("Invalid repository change detail.");
    return detail;
  });
}
