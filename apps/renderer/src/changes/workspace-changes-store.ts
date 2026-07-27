import type { WorkspaceChangesProjection, WorkspaceChangeView } from "@pi67/domain";
import { create } from "zustand";
import {
  matchesCommittedSessionProjection,
  type SessionProjectionAuthorityState
} from "../session/session-projection-authority.js";
import {
  useSessionProjectionStore,
  type FeatureProjectionAuthority
} from "../session/session-projection-store.js";
import { upsertWorkspaceChange } from "./changes-projection.js";

export type WorkspaceChangesAuthority = FeatureProjectionAuthority;

export interface WorkspaceChangesTarget extends WorkspaceChangesAuthority {
  contentRevision: number;
  requestRevision: number;
}

export interface WorkspaceChangesProjectionView {
  authority: WorkspaceChangesAuthority | undefined;
  projection: WorkspaceChangesProjection | undefined;
  byToolCallId: ReadonlyMap<string, WorkspaceChangeView>;
  status: "idle" | "stale" | "loading" | "ready";
}

interface WorkspaceChangesState {
  authority: WorkspaceChangesAuthority | undefined;
  contentRevision: number;
  requestRevision: number;
  projection: WorkspaceChangesProjection | undefined;
  byToolCallId: ReadonlyMap<string, WorkspaceChangeView>;
  status: "idle" | "stale" | "loading" | "ready";
  beginSession: (authority: WorkspaceChangesAuthority) => void;
  installProjection: (
    authority: WorkspaceChangesAuthority,
    projection: WorkspaceChangesProjection
  ) => boolean;
  applyChange: (authority: WorkspaceChangesAuthority, change: WorkspaceChangeView) => boolean;
  reset: (status?: "idle" | "stale") => void;
  beginRefresh: (
    canonicalAuthority: SessionProjectionAuthorityState
  ) => WorkspaceChangesTarget | undefined;
  finishRefresh: (
    target: WorkspaceChangesTarget,
    projection: WorkspaceChangesProjection
  ) => boolean;
  failRefresh: (target: WorkspaceChangesTarget) => boolean;
}

const EMPTY_CHANGE_INDEX: ReadonlyMap<string, WorkspaceChangeView> = new Map();
const EMPTY_WORKSPACE_CHANGES_PROJECTION: WorkspaceChangesProjectionView = {
  authority: undefined,
  projection: undefined,
  byToolCallId: EMPTY_CHANGE_INDEX,
  status: "stale"
};

export const useWorkspaceChangesStore = create<WorkspaceChangesState>((set, get) => ({
  authority: undefined,
  contentRevision: 0,
  requestRevision: 0,
  projection: undefined,
  byToolCallId: new Map(),
  status: "idle",

  beginSession(authority) {
    const current = get().authority;
    if (matchesAuthority(current, authority)) return;
    set((state) => ({
      authority,
      contentRevision: state.contentRevision + 1,
      projection: undefined,
      byToolCallId: new Map(),
      status: "stale"
    }));
  },

  installProjection(authority, projection) {
    if (projection.sessionId !== authority.sessionId) return false;
    set((state) => ({
      authority,
      contentRevision: state.contentRevision + 1,
      projection,
      byToolCallId: indexProjection(projection),
      status: "ready"
    }));
    return true;
  },

  applyChange(authority, change) {
    const state = get();
    if (!matchesAuthority(state.authority, authority)) return false;
    const projection = upsertWorkspaceChange(state.projection, authority.sessionId, change);
    set({
      authority: state.authority,
      projection,
      byToolCallId: indexProjection(projection)
    });
    return true;
  },

  reset(status = "idle") {
    set((state) => ({
      authority: undefined,
      contentRevision: state.contentRevision + 1,
      projection: undefined,
      byToolCallId: new Map(),
      status
    }));
  },

  beginRefresh(canonicalAuthority) {
    const state = get();
    if (!matchesCommittedSessionProjection(state.authority, canonicalAuthority)) return undefined;
    const target = currentTarget(state, state.requestRevision + 1);
    if (!target) return undefined;
    set({ requestRevision: target.requestRevision, status: "loading" });
    return target;
  },

  finishRefresh(target, projection) {
    if (!matchesCurrentTarget(get(), target) || projection.sessionId !== target.sessionId) return false;
    set({ projection, byToolCallId: indexProjection(projection), status: "ready" });
    return true;
  },

  failRefresh(target) {
    if (!matchesCurrentTarget(get(), target)) return false;
    set({ status: "stale" });
    return true;
  }
}));

export function selectCommittedWorkspaceChangesProjection(
  state: WorkspaceChangesProjectionView,
  canonicalAuthority: SessionProjectionAuthorityState
): WorkspaceChangesProjectionView {
  return matchesCommittedSessionProjection(state.authority, canonicalAuthority)
    ? state
    : EMPTY_WORKSPACE_CHANGES_PROJECTION;
}

export function useCommittedWorkspaceChangesProjection(): WorkspaceChangesProjectionView {
  const canonicalAuthority = useSessionProjectionStore((state) => state.authority);
  return useWorkspaceChangesStore((state) => (
    selectCommittedWorkspaceChangesProjection(state, canonicalAuthority)
  ));
}

export function useCommittedWorkspaceChange(
  toolCallId: string
): WorkspaceChangeView | undefined {
  const canonicalAuthority = useSessionProjectionStore((state) => state.authority);
  return useWorkspaceChangesStore((state) => (
    matchesCommittedSessionProjection(state.authority, canonicalAuthority)
      ? state.byToolCallId.get(toolCallId)
      : undefined
  ));
}

function currentTarget(
  state: WorkspaceChangesState,
  requestRevision: number
): WorkspaceChangesTarget | undefined {
  return state.authority
    ? { ...state.authority, contentRevision: state.contentRevision, requestRevision }
    : undefined;
}

function matchesCurrentTarget(state: WorkspaceChangesState, target: WorkspaceChangesTarget): boolean {
  return state.contentRevision === target.contentRevision
    && state.requestRevision === target.requestRevision
    && matchesAuthority(state.authority, target);
}

function matchesAuthority(
  current: WorkspaceChangesAuthority | undefined,
  incoming: WorkspaceChangesAuthority
): boolean {
  return current !== undefined
    && current.hostEpoch === incoming.hostEpoch
    && current.sessionId === incoming.sessionId
    && current.sessionGeneration === incoming.sessionGeneration
    && current.projectionRevision === incoming.projectionRevision;
}

function indexProjection(
  projection: WorkspaceChangesProjection
): ReadonlyMap<string, WorkspaceChangeView> {
  return new Map(projection.items.map((change) => [change.toolCallId, change]));
}
