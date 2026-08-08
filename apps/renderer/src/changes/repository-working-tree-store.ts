import type {
  RepositoryChangeDetail,
  RepositoryWorkingTreeSnapshot
} from "@pi67/domain";
import { create } from "zustand";

interface RepositoryWorkingTreeState {
  workspaceId: string | undefined;
  requestRevision: number;
  status: "idle" | "loading" | "ready" | "error";
  snapshot: RepositoryWorkingTreeSnapshot | undefined;
  error: string | undefined;
  detailByChangeId: Record<string, RepositoryChangeDetail>;
  detailLoadingId: string | undefined;
  detailError: string | undefined;
  viewedByWorkspace: Record<string, Record<string, string>>;
  begin(workspaceId: string): number;
  finish(workspaceId: string, requestRevision: number, snapshot: RepositoryWorkingTreeSnapshot): boolean;
  fail(workspaceId: string, requestRevision: number, error: string): boolean;
  beginDetail(workspaceId: string, revision: number, changeId: string): boolean;
  finishDetail(detail: RepositoryChangeDetail): boolean;
  failDetail(workspaceId: string, revision: number, changeId: string, error: string): boolean;
  reset(): void;
}

const INITIAL = {
  workspaceId: undefined,
  requestRevision: 0,
  status: "idle" as const,
  snapshot: undefined,
  error: undefined,
  detailByChangeId: {},
  detailLoadingId: undefined,
  detailError: undefined,
  viewedByWorkspace: {}
};

export const useRepositoryWorkingTreeStore = create<RepositoryWorkingTreeState>((set, get) => ({
  ...INITIAL,
  begin(workspaceId) {
    const requestRevision = get().requestRevision + 1;
    set({
      workspaceId,
      requestRevision,
      status: "loading",
      error: undefined,
      ...(get().workspaceId === workspaceId ? {} : {
        snapshot: undefined,
        detailByChangeId: {},
        detailLoadingId: undefined,
        detailError: undefined
      })
    });
    return requestRevision;
  },
  finish(workspaceId, requestRevision, snapshot) {
    const state = get();
    if (state.workspaceId !== workspaceId || state.requestRevision !== requestRevision) return false;
    set({
      status: "ready",
      snapshot,
      error: undefined,
      detailByChangeId: {},
      detailLoadingId: undefined,
      detailError: undefined
    });
    return true;
  },
  fail(workspaceId, requestRevision, error) {
    const state = get();
    if (state.workspaceId !== workspaceId || state.requestRevision !== requestRevision) return false;
    set({ status: "error", error });
    return true;
  },
  beginDetail(workspaceId, revision, changeId) {
    const snapshot = get().snapshot;
    if (!snapshot || snapshot.workspaceId !== workspaceId || snapshot.revision !== revision) return false;
    set({ detailLoadingId: changeId, detailError: undefined });
    return true;
  },
  finishDetail(detail) {
    const state = get();
    const snapshot = state.snapshot;
    if (
      !snapshot
      || state.detailLoadingId !== detail.changeId
      || snapshot.workspaceId !== detail.workspaceId
      || snapshot.revision !== detail.revision
    ) return false;
    set({
      detailLoadingId: undefined,
      detailError: undefined,
      detailByChangeId: { ...state.detailByChangeId, [detail.changeId]: detail },
      viewedByWorkspace: {
        ...state.viewedByWorkspace,
        [detail.workspaceId]: {
          ...state.viewedByWorkspace[detail.workspaceId],
          [detail.changeId]: detail.contentFingerprint
        }
      }
    });
    return true;
  },
  failDetail(workspaceId, revision, changeId, detailError) {
    const state = get();
    const snapshot = state.snapshot;
    if (
      !snapshot
      || state.detailLoadingId !== changeId
      || snapshot.workspaceId !== workspaceId
      || snapshot.revision !== revision
    ) return false;
    set({ detailLoadingId: undefined, detailError });
    return true;
  },
  reset() { set({ ...INITIAL, requestRevision: get().requestRevision + 1 }); }
}));

export function repositoryChangeViewed(
  workspaceId: string,
  detail: RepositoryChangeDetail | undefined,
  viewed: Readonly<Record<string, string>> | undefined
): boolean {
  return Boolean(
    detail
    && detail.workspaceId === workspaceId
    && viewed?.[detail.changeId] === detail.contentFingerprint
  );
}
