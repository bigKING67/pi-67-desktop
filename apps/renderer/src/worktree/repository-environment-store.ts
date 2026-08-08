import type { RepositoryEnvironmentSnapshot } from "@pi67/protocol";
import { create } from "zustand";

export interface RepositoryEnvironmentRecord {
  requestRevision: number;
  status: "idle" | "loading" | "ready" | "error";
  snapshot?: RepositoryEnvironmentSnapshot;
  error?: string;
}

interface RepositoryEnvironmentRequestTarget {
  workspaceId: string;
  requestRevision: number;
}

interface RepositoryEnvironmentState {
  records: Record<string, RepositoryEnvironmentRecord>;
  beginInspection(workspaceId: string): RepositoryEnvironmentRequestTarget;
  finishInspection(
    target: RepositoryEnvironmentRequestTarget,
    snapshot: RepositoryEnvironmentSnapshot
  ): boolean;
  failInspection(target: RepositoryEnvironmentRequestTarget, error: string): boolean;
  removeWorkspace(workspaceId: string): void;
  reset(): void;
}

const IDLE_RECORD: RepositoryEnvironmentRecord = { requestRevision: 0, status: "idle" };

export const useRepositoryEnvironmentStore = create<RepositoryEnvironmentState>((set, get) => ({
  records: {},

  beginInspection(workspaceId) {
    const current = get().records[workspaceId] ?? IDLE_RECORD;
    const target = { workspaceId, requestRevision: current.requestRevision + 1 };
    set((state) => ({
      records: {
        ...state.records,
        [workspaceId]: {
          requestRevision: target.requestRevision,
          status: "loading",
          ...(current.snapshot ? { snapshot: current.snapshot } : {})
        }
      }
    }));
    return target;
  },

  finishInspection(target, snapshot) {
    const current = get().records[target.workspaceId];
    if (
      !current
      || current.requestRevision !== target.requestRevision
      || snapshot.workspaceId !== target.workspaceId
    ) return false;
    set((state) => ({
      records: {
        ...state.records,
        [target.workspaceId]: {
          requestRevision: target.requestRevision,
          status: "ready",
          snapshot
        }
      }
    }));
    return true;
  },

  failInspection(target, error) {
    const current = get().records[target.workspaceId];
    if (!current || current.requestRevision !== target.requestRevision) return false;
    set((state) => ({
      records: {
        ...state.records,
        [target.workspaceId]: {
          requestRevision: target.requestRevision,
          status: "error",
          ...(current.snapshot ? { snapshot: current.snapshot } : {}),
          error
        }
      }
    }));
    return true;
  },

  removeWorkspace(workspaceId) {
    set((state) => {
      if (!state.records[workspaceId]) return state;
      const records = { ...state.records };
      delete records[workspaceId];
      return { records };
    });
  },

  reset() {
    set({ records: {} });
  }
}));

export function repositoryEnvironmentRecord(workspaceId: string | undefined): RepositoryEnvironmentRecord {
  return workspaceId
    ? useRepositoryEnvironmentStore.getState().records[workspaceId] ?? IDLE_RECORD
    : IDLE_RECORD;
}
