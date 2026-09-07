interface WorkspaceCleanup {
  removeWorkspace(workspaceId: string): void | Promise<void>;
}

interface WorkspaceCleanupServices {
  composerDraftState: WorkspaceCleanup;
  promptStashImages: WorkspaceCleanup;
  workspaceFileState: WorkspaceCleanup;
  repositoryEnvironmentInspection: WorkspaceCleanup;
  repositoryWorkingTree: WorkspaceCleanup;
}

export async function cleanRemovedWorkspaceState(workspaceId: string, services: WorkspaceCleanupServices): Promise<void> {
  const failures: unknown[] = [];
  for (const service of [
    services.composerDraftState,
    services.promptStashImages,
    services.workspaceFileState,
    services.repositoryEnvironmentInspection,
    services.repositoryWorkingTree
  ]) {
    try {
      await service.removeWorkspace(workspaceId);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Workspace cleanup failed after registration removal.");
}
