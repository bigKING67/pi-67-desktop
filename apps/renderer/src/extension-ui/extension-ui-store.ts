import type {
  ExtensionCatalogResult,
  ExtensionCompatibilityEventView,
  ExtensionUiRequestView
} from "@pi67/domain";
import { create } from "zustand";
import {
  matchesCommittedSessionProjection,
  type SessionProjectionAuthorityState
} from "../session/session-projection-authority.js";
import {
  useSessionProjectionStore,
  type FeatureProjectionAuthority
} from "../session/session-projection-store.js";
import {
  extensionCompatibilityItem,
  extensionUiItemId,
  type ExtensionCompatibilityItem,
  type ExtensionStatusItem,
  type ExtensionWidgetItem
} from "./extension-ui-state.js";

interface StagedExtensionCatalog {
  hostEpoch: number;
  sessionId: string;
  sessionGeneration: number;
  projectionRevision: number;
  operationId?: string;
  catalog: ExtensionCatalogResult;
}

export interface ExtensionCatalogProjection {
  authority: FeatureProjectionAuthority;
  value: ExtensionCatalogResult;
}

interface ExtensionUiState {
  requests: ExtensionUiRequestView[];
  statuses: Record<string, ExtensionStatusItem>;
  widgets: Record<string, ExtensionWidgetItem>;
  compatibility: Record<string, ExtensionCompatibilityItem>;
  catalog: ExtensionCatalogProjection | undefined;
  stagedCatalog: StagedExtensionCatalog | undefined;
  title: string | undefined;
  upsertRequest: (request: ExtensionUiRequestView) => void;
  removeRequest: (requestId: string) => void;
  removeRequestIfCurrent: (request: ExtensionUiRequestView) => boolean;
  cancelRequests: (requestIds: string[]) => void;
  applyUpdate: (request: ExtensionUiRequestView) => void;
  applyCompatibility: (event: ExtensionCompatibilityEventView) => void;
  installCatalog: (
    authority: FeatureProjectionAuthority,
    catalog: ExtensionCatalogResult
  ) => void;
  stageCatalog: (catalog: StagedExtensionCatalog) => void;
  resetInteractive: () => void;
  resetCatalog: () => void;
  reset: () => void;
}

export const useExtensionUiStore = create<ExtensionUiState>((set) => ({
  ...emptyExtensionUiState(),

  upsertRequest(request) {
    set((state) => {
      const index = state.requests.findIndex((candidate) => candidate.requestId === request.requestId);
      if (index === -1) return { requests: [...state.requests, request] };
      const requests = [...state.requests];
      requests[index] = request;
      return { requests };
    });
  },

  removeRequest(requestId) {
    set((state) => {
      const requests = state.requests.filter((request) => request.requestId !== requestId);
      return requests.length === state.requests.length ? state : { requests };
    });
  },

  removeRequestIfCurrent(request) {
    let removed = false;
    set((state) => {
      const index = state.requests.findIndex((candidate) => candidate === request);
      if (index === -1) return state;
      removed = true;
      return { requests: state.requests.filter((_, candidateIndex) => candidateIndex !== index) };
    });
    return removed;
  },

  cancelRequests(requestIds) {
    if (requestIds.length === 0) return;
    const cancelled = new Set(requestIds);
    set((state) => {
      const requests = state.requests.filter((request) => !cancelled.has(request.requestId));
      return requests.length === state.requests.length ? state : { requests };
    });
  },

  applyUpdate(request) {
    if (request.kind === "status" && request.key) {
      const id = extensionUiItemId(request);
      if (!id) return;
      const key = request.key;
      set((state) => {
        const statuses = { ...state.statuses };
        if (request.message === undefined) delete statuses[id];
        else statuses[id] = {
          id,
          key,
          message: request.message,
          attribution: "unattributed"
        };
        return { statuses };
      });
      return;
    }
    if (request.kind === "widget" && request.key) {
      const id = extensionUiItemId(request);
      if (!id) return;
      const key = request.key;
      set((state) => {
        const widgets = { ...state.widgets };
        if (request.message === undefined) delete widgets[id];
        else widgets[id] = {
          id,
          key,
          message: request.message,
          placement: request.placement ?? "aboveEditor",
          attribution: "unattributed"
        };
        return { widgets };
      });
      return;
    }
    if (request.kind === "title") {
      set({ title: request.message?.trim() || undefined });
    }
  },

  applyCompatibility(event) {
    const item = extensionCompatibilityItem(event);
    set((state) => ({
      compatibility: { ...state.compatibility, [item.id]: item }
    }));
  },

  installCatalog(authority, catalog) {
    const projection: ExtensionCatalogProjection = { authority, value: catalog };
    set((state) => state.catalog?.value === catalog
      && matchesCatalogAuthority(state.catalog.authority, authority)
      && state.stagedCatalog === undefined
      ? state
      : { catalog: projection, stagedCatalog: undefined });
  },

  stageCatalog(stagedCatalog) {
    set({ stagedCatalog });
  },

  resetInteractive() {
    set(emptyInteractiveState());
  },

  resetCatalog() {
    set({
      compatibility: {},
      catalog: undefined,
      stagedCatalog: undefined
    });
  },

  reset() {
    set(emptyExtensionUiState());
  }
}));

export function selectCommittedExtensionCatalog(
  catalog: ExtensionCatalogProjection | undefined,
  canonicalAuthority: SessionProjectionAuthorityState
): ExtensionCatalogResult | undefined {
  return matchesCommittedSessionProjection(catalog?.authority, canonicalAuthority)
    ? catalog?.value
    : undefined;
}

export function useCommittedExtensionCatalog(): ExtensionCatalogResult | undefined {
  const canonicalAuthority = useSessionProjectionStore((state) => state.authority);
  return useExtensionUiStore((state) => (
    selectCommittedExtensionCatalog(state.catalog, canonicalAuthority)
  ));
}

export function resetExtensionUiInteractiveState(): void {
  useExtensionUiStore.getState().resetInteractive();
}

export function resetExtensionUiCatalogState(): void {
  useExtensionUiStore.getState().resetCatalog();
}

function emptyInteractiveState(): Pick<ExtensionUiState,
  | "requests"
  | "statuses"
  | "widgets"
  | "title"
> {
  return {
    requests: [],
    statuses: {},
    widgets: {},
    title: undefined
  };
}

function emptyExtensionUiState(): Pick<ExtensionUiState,
  | "requests"
  | "statuses"
  | "widgets"
  | "compatibility"
  | "catalog"
  | "stagedCatalog"
  | "title"
> {
  return {
    ...emptyInteractiveState(),
    compatibility: {},
    catalog: undefined,
    stagedCatalog: undefined
  };
}

function matchesCatalogAuthority(
  current: FeatureProjectionAuthority,
  incoming: FeatureProjectionAuthority
): boolean {
  return current.hostEpoch === incoming.hostEpoch
    && current.sessionId === incoming.sessionId
    && current.sessionGeneration === incoming.sessionGeneration
    && current.projectionRevision === incoming.projectionRevision;
}
