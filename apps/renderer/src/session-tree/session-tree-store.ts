import type { SessionTreeProjection } from "@pi67/domain";
import { create } from "zustand";
import {
  matchesCommittedSessionProjection,
  type SessionProjectionAuthorityState
} from "../session/session-projection-authority.js";
import {
  useSessionProjectionStore,
  type FeatureProjectionAuthority
} from "../session/session-projection-store.js";

export type SessionTreeAuthority = FeatureProjectionAuthority;

interface SessionTreeRequestTarget extends SessionTreeAuthority {
  contentRevision: number;
  requestRevision: number;
  changeRevision: number;
}

type SessionTreeStatus = "idle" | "stale" | "loading" | "ready";
type SessionTreeRefreshResult = "discarded" | "ready" | "superseded";

export interface SessionTreeProjectionView {
  authority: SessionTreeAuthority | undefined;
  tree: SessionTreeProjection;
  status: SessionTreeStatus;
}

interface SessionTreeState {
  authority: SessionTreeAuthority | undefined;
  contentRevision: number;
  requestRevision: number;
  changeRevision: number;
  refreshedChangeRevision: number;
  tree: SessionTreeProjection;
  status: SessionTreeStatus;
  replaceProjection: (
    authority: SessionTreeAuthority,
    tree: SessionTreeProjection
  ) => boolean;
  reset: (status?: Extract<SessionTreeStatus, "idle" | "stale">) => void;
  markChanged: (authority: SessionTreeAuthority) => boolean;
  beginRefresh: (
    canonicalAuthority: SessionProjectionAuthorityState
  ) => SessionTreeRequestTarget | undefined;
  finishRefresh: (
    target: SessionTreeRequestTarget,
    tree: SessionTreeProjection
  ) => SessionTreeRefreshResult;
  deferRefresh: (target: SessionTreeRequestTarget) => boolean;
  failRefresh: (target: SessionTreeRequestTarget) => boolean;
  needsRefresh: (canonicalAuthority: SessionProjectionAuthorityState) => boolean;
}

const EMPTY_TREE: SessionTreeProjection = { nodes: [], truncated: false, total: 0 };
const EMPTY_SESSION_TREE_PROJECTION: SessionTreeProjectionView = {
  authority: undefined,
  tree: EMPTY_TREE,
  status: "stale"
};

export const useSessionTreeStore = create<SessionTreeState>((set, get) => ({
  authority: undefined,
  contentRevision: 0,
  requestRevision: 0,
  changeRevision: 0,
  refreshedChangeRevision: 0,
  tree: EMPTY_TREE,
  status: "idle",

  replaceProjection(authority, tree) {
    set((state) => ({
      authority,
      contentRevision: state.contentRevision + 1,
      requestRevision: 0,
      changeRevision: 0,
      refreshedChangeRevision: 0,
      tree,
      status: "ready"
    }));
    return matchesProjectionAuthority(get().authority, authority);
  },

  reset(status = "idle") {
    set((state) => ({
      authority: undefined,
      contentRevision: state.contentRevision + 1,
      requestRevision: 0,
      changeRevision: 0,
      refreshedChangeRevision: 0,
      tree: EMPTY_TREE,
      status
    }));
  },

  markChanged(authority) {
    const state = get();
    if (!matchesProjectionAuthority(state.authority, authority)) return false;
    set({
      authority,
      changeRevision: state.changeRevision + 1,
      status: "stale"
    });
    return true;
  },

  beginRefresh(canonicalAuthority) {
    const state = get();
    if (!state.needsRefresh(canonicalAuthority)) return undefined;
    const target = {
      ...state.authority!,
      contentRevision: state.contentRevision,
      requestRevision: state.requestRevision + 1,
      changeRevision: state.changeRevision
    };
    set({ requestRevision: target.requestRevision, status: "loading" });
    return target;
  },

  finishRefresh(target, tree) {
    const state = get();
    if (!matchesTarget(state, target)) return "discarded";
    const superseded = state.changeRevision > target.changeRevision;
    set({
      tree,
      refreshedChangeRevision: target.changeRevision,
      status: superseded ? "stale" : "ready"
    });
    return superseded ? "superseded" : "ready";
  },

  deferRefresh(target) {
    if (!matchesTarget(get(), target)) return false;
    set({ status: "stale" });
    return true;
  },

  failRefresh(target) {
    const state = get();
    if (!matchesTarget(state, target)) return false;
    set({
      refreshedChangeRevision: target.changeRevision,
      status: "stale"
    });
    return true;
  },

  needsRefresh(canonicalAuthority) {
    const state = get();
    return matchesCommittedSessionProjection(state.authority, canonicalAuthority)
      && state.changeRevision > state.refreshedChangeRevision;
  }
}));

export function selectCommittedSessionTreeProjection(
  state: SessionTreeProjectionView,
  canonicalAuthority: SessionProjectionAuthorityState
): SessionTreeProjectionView {
  return matchesCommittedSessionProjection(state.authority, canonicalAuthority)
    ? state
    : EMPTY_SESSION_TREE_PROJECTION;
}

export function useCommittedSessionTreeProjection(): SessionTreeProjectionView {
  const canonicalAuthority = useSessionProjectionStore((state) => state.authority);
  return useSessionTreeStore((state) => (
    selectCommittedSessionTreeProjection(state, canonicalAuthority)
  ));
}

function matchesProjectionAuthority(
  current: SessionTreeAuthority | undefined,
  incoming: SessionTreeAuthority
): boolean {
  return current !== undefined
    && current.hostEpoch === incoming.hostEpoch
    && current.sessionId === incoming.sessionId
    && current.sessionGeneration === incoming.sessionGeneration
    && current.projectionRevision === incoming.projectionRevision;
}

function matchesTarget(
  state: Pick<SessionTreeState, "authority" | "contentRevision" | "requestRevision">,
  target: SessionTreeRequestTarget
): boolean {
  return state.contentRevision === target.contentRevision
    && state.requestRevision === target.requestRevision
    && state.authority?.hostEpoch === target.hostEpoch
    && state.authority.sessionId === target.sessionId
    && state.authority.sessionGeneration === target.sessionGeneration
    && state.authority.projectionRevision === target.projectionRevision;
}
