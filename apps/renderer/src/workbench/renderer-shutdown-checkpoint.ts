import {
  initializeRendererWorkbench,
  persistRendererWorkbenchCheckpoint
} from "./workbench-controller.js";
import { taskDraftShutdownCheckpoint } from "./task-draft-shutdown.js";

interface RendererShutdownCheckpointDependencies {
  initializeWorkbench(): Promise<void>;
  initializeDraftPersistence(): Promise<void>;
  beginDraftShutdown(): void;
  persistDrafts(): Promise<void>;
  persistWorkbench(): Promise<void>;
}

export function installRendererShutdownCheckpoint(
  dependencies: RendererShutdownCheckpointDependencies
): () => void {
  let checkpointFlight: Promise<boolean> | undefined;
  return window.pi67.system.onShutdownCheckpointRequested((requestId) => {
    checkpointFlight ??= runRendererShutdownCheckpoint(dependencies);
    void checkpointFlight.then((succeeded) => (
      window.pi67.system.completeShutdownCheckpoint({ requestId, succeeded })
    )).catch(() => undefined);
  });
}

export async function runRendererShutdownCheckpoint(
  dependencies: RendererShutdownCheckpointDependencies
): Promise<boolean> {
  try {
    await Promise.all([
      dependencies.initializeWorkbench(),
      dependencies.initializeDraftPersistence()
    ]);
    dependencies.beginDraftShutdown();
    await dependencies.persistDrafts();
    await dependencies.persistWorkbench();
    return true;
  } catch {
    return false;
  }
}

export const rendererShutdownCheckpointDependencies = {
  initializeWorkbench: initializeRendererWorkbench,
  initializeDraftPersistence: taskDraftShutdownCheckpoint.initialize,
  beginDraftShutdown: taskDraftShutdownCheckpoint.begin,
  persistDrafts: taskDraftShutdownCheckpoint.persist,
  persistWorkbench: persistRendererWorkbenchCheckpoint
};
