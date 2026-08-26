import { useRepositoryEnvironmentStore } from "./repository-environment-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useAppStore } from "../app/app-store.js";

const inspectionFlights = new Map<string, Promise<void>>();
const actionFlights = new Map<string, Promise<boolean>>();

export function inspectRepositoryEnvironment(workspaceId: string): Promise<void> {
  const existing = inspectionFlights.get(workspaceId);
  if (existing) return existing;
  const target = useRepositoryEnvironmentStore.getState().beginInspection(workspaceId);
  const flight = window.pi67.system.inspectRepositoryEnvironment({ workspaceId })
    .then((snapshot) => {
      useRepositoryEnvironmentStore.getState().finishInspection(target, snapshot);
    })
    .catch((error: unknown) => {
      useRepositoryEnvironmentStore.getState().failInspection(target, errorMessage(error));
    })
    .finally(() => {
      if (inspectionFlights.get(workspaceId) === flight) inspectionFlights.delete(workspaceId);
    });
  inspectionFlights.set(workspaceId, flight);
  return flight;
}

export function initializeRepositorySubmodules(workspaceId: string): Promise<boolean> {
  return runAction(`submodules:${workspaceId}`, async () => {
    const result = await window.pi67.system.initializeRepositorySubmodules({
      workspaceId,
      mode: "network-explicit"
    });
    await inspectRepositoryEnvironment(workspaceId);
    return result.status === "initialized";
  });
}

export function recoverAppOwnedWorktree(workspaceId: string): Promise<boolean> {
  return runAction(`recovery:${workspaceId}`, async () => {
    const result = await window.pi67.system.recoverAppOwnedWorktree({
      workspaceId,
      confirmation: "recreate-committed-state"
    });
    if (result.status !== "recovered") return false;
    rendererWorkbenchStore.getState().registerWorkspace(result.workspace);
    if (rendererWorkbenchStore.getState().currentWorkspaceId === workspaceId) {
      useAppStore.setState({
        workspace: result.workspace.identity.canonicalPath,
        trust: result.workspace.trust,
        trustUpdating: false
      });
    }
    await inspectRepositoryEnvironment(workspaceId);
    return true;
  });
}

function runAction(key: string, operation: () => Promise<boolean>): Promise<boolean> {
  const existing = actionFlights.get(key);
  if (existing) return existing;
  const flight = operation().catch(() => false).finally(() => {
    if (actionFlights.get(key) === flight) actionFlights.delete(key);
  });
  actionFlights.set(key, flight);
  return flight;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Repository environment inspection failed.";
}
