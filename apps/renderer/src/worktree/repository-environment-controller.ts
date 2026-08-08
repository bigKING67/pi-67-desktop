import { useRepositoryEnvironmentStore } from "./repository-environment-store.js";

const inspectionFlights = new Map<string, Promise<void>>();

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Repository environment inspection failed.";
}
