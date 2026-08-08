import { ipcMain } from "electron";
import {
  isRepositoryEnvironmentSnapshot,
  parseRepositoryEnvironmentInspectionRequest,
  type RepositoryEnvironmentSnapshot
} from "@pi67/protocol";

export interface RepositoryEnvironmentInspectionBridge {
  inspect(value: { workspaceId: string }): Promise<RepositoryEnvironmentSnapshot>;
  removeWorkspace(workspaceId: string): Promise<void>;
  dispose(): void;
}

export function registerRepositoryEnvironmentBridge(
  inspection: RepositoryEnvironmentInspectionBridge
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
}
