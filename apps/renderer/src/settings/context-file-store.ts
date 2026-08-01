import type {
  ContextFileCatalogResult,
  ContextFileReadResult,
  ContextFileSaveResult,
  ContextFileSummary
} from "@pi67/domain";
import { create } from "zustand";

type ContextFilePhase = "idle" | "loading-catalog" | "loading-file" | "saving" | "failed";

export interface ContextFileState {
  workspaceId: string | undefined;
  catalog: ContextFileCatalogResult | undefined;
  selectedItem: ContextFileSummary | undefined;
  baselineContent: string | undefined;
  draft: string | undefined;
  baselineRevision: string | undefined;
  dirty: boolean;
  externalConflict: boolean;
  phase: ContextFilePhase;
  error: string | undefined;
  beginCatalogLoad(workspaceId: string): void;
  installCatalog(workspaceId: string, catalog: ContextFileCatalogResult): void;
  beginRead(workspaceId: string, id: string): void;
  installRead(workspaceId: string, id: string, result: ContextFileReadResult): void;
  updateDraft(content: string): void;
  beginSave(): void;
  installSave(workspaceId: string, id: string, content: string, result: ContextFileSaveResult): void;
  markConflict(message: string): void;
  fail(workspaceId: string, message: string): void;
  discardDraft(): void;
  clearSelection(): void;
  reset(): void;
}

export const useContextFileStore = create<ContextFileState>((set, get) => ({
  workspaceId: undefined,
  catalog: undefined,
  selectedItem: undefined,
  baselineContent: undefined,
  draft: undefined,
  baselineRevision: undefined,
  dirty: false,
  externalConflict: false,
  phase: "idle",
  error: undefined,

  beginCatalogLoad(workspaceId) {
    set((state) => ({
      workspaceId,
      phase: "loading-catalog",
      error: undefined,
      ...(state.workspaceId === workspaceId ? {} : emptyFileState())
    }));
  },

  installCatalog(workspaceId, catalog) {
    const state = get();
    if (state.workspaceId !== workspaceId) return;
    const selectedItem = state.selectedItem
      ? catalog.items.find((item) => item.id === state.selectedItem?.id)
      : undefined;
    set({ catalog, selectedItem, phase: "idle", error: undefined });
  },

  beginRead(workspaceId, id) {
    set((state) => ({
      workspaceId,
      selectedItem: state.catalog?.items.find((item) => item.id === id),
      baselineContent: undefined,
      draft: undefined,
      baselineRevision: undefined,
      dirty: false,
      externalConflict: false,
      phase: "loading-file",
      error: undefined
    }));
  },

  installRead(workspaceId, id, result) {
    const state = get();
    if (state.workspaceId !== workspaceId || state.selectedItem?.id !== id) return;
    set({
      selectedItem: result.item,
      baselineContent: result.content,
      draft: result.content,
      baselineRevision: result.revision,
      dirty: false,
      externalConflict: false,
      phase: "idle",
      error: undefined
    });
  },

  updateDraft(content) {
    const state = get();
    if (state.draft === undefined) return;
    set({
      draft: content,
      dirty: content !== state.baselineContent,
      error: undefined
    });
  },

  beginSave() {
    set({ phase: "saving", error: undefined });
  },

  installSave(workspaceId, id, content, result) {
    const state = get();
    if (state.workspaceId !== workspaceId || state.selectedItem?.id !== id) return;
    set({
      catalog: result.files,
      selectedItem: result.item,
      baselineContent: content,
      draft: content,
      baselineRevision: result.revision,
      dirty: false,
      externalConflict: false,
      phase: "idle",
      error: undefined
    });
  },

  markConflict(message) {
    set({ externalConflict: true, phase: "idle", error: message });
  },

  fail(workspaceId, message) {
    if (get().workspaceId !== workspaceId) return;
    set({ phase: "failed", error: message });
  },

  discardDraft() {
    const state = get();
    set({
      draft: state.baselineContent,
      dirty: false,
      externalConflict: false,
      phase: "idle",
      error: undefined
    });
  },

  clearSelection() {
    set({
      selectedItem: undefined,
      baselineContent: undefined,
      draft: undefined,
      baselineRevision: undefined,
      dirty: false,
      externalConflict: false,
      phase: "idle",
      error: undefined
    });
  },

  reset() {
    set({ workspaceId: undefined, ...emptyFileState(), phase: "idle", error: undefined });
  }
}));

function emptyFileState() {
  return {
    catalog: undefined,
    selectedItem: undefined,
    baselineContent: undefined,
    draft: undefined,
    baselineRevision: undefined,
    dirty: false,
    externalConflict: false
  } as const;
}
