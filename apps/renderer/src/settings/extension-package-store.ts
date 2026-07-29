import type {
  ExtensionPackageEntry,
  ExtensionPackageUpdate
} from "@pi67/domain";
import { create } from "zustand";

type ExtensionPackagePhase = "idle" | "loading" | "checking" | "mutating" | "failed";

interface ExtensionPackageState {
  workspaceId: string | undefined;
  items: ExtensionPackageEntry[];
  updates: ExtensionPackageUpdate[];
  phase: ExtensionPackagePhase;
  error: string | undefined;
  begin: (workspaceId: string, phase: Exclude<ExtensionPackagePhase, "idle" | "failed">) => void;
  installList: (workspaceId: string, items: ExtensionPackageEntry[]) => void;
  installUpdates: (workspaceId: string, updates: ExtensionPackageUpdate[]) => void;
  removeUpdate: (workspaceId: string, source: string, scope: ExtensionPackageEntry["scope"]) => void;
  fail: (workspaceId: string, error: string) => void;
  reset: () => void;
}

export const useExtensionPackageStore = create<ExtensionPackageState>((set, get) => ({
  workspaceId: undefined,
  items: [],
  updates: [],
  phase: "idle",
  error: undefined,

  begin(workspaceId, phase) {
    set((state) => ({
      workspaceId,
      phase,
      error: undefined,
      ...(state.workspaceId === workspaceId ? {} : { items: [], updates: [] })
    }));
  },

  installList(workspaceId, items) {
    if (get().workspaceId !== workspaceId) return;
    set({ items, phase: "idle", error: undefined });
  },

  installUpdates(workspaceId, updates) {
    if (get().workspaceId !== workspaceId) return;
    set({ updates, phase: "idle", error: undefined });
  },

  removeUpdate(workspaceId, source, scope) {
    if (get().workspaceId !== workspaceId) return;
    set((state) => ({
      updates: state.updates.filter((entry) => entry.source !== source || entry.scope !== scope)
    }));
  },

  fail(workspaceId, error) {
    if (get().workspaceId !== workspaceId) return;
    set({ phase: "failed", error });
  },

  reset() {
    set({ workspaceId: undefined, items: [], updates: [], phase: "idle", error: undefined });
  }
}));
