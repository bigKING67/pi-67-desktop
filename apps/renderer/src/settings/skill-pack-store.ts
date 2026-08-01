import type { SkillPackEntry } from "@pi67/domain";
import { create } from "zustand";

type SkillPackPhase = "idle" | "loading" | "checking" | "updating" | "restoring" | "failed";

interface SkillPackState {
  workspaceId: string | undefined;
  items: SkillPackEntry[];
  checkedAt: number | undefined;
  phase: SkillPackPhase;
  error: string | undefined;
  begin: (workspaceId: string, phase: Exclude<SkillPackPhase, "idle" | "failed">) => void;
  install: (workspaceId: string, items: SkillPackEntry[], checkedAt?: number) => void;
  invalidate: (workspaceId: string, id: string, error: string) => void;
  fail: (workspaceId: string, error: string) => void;
  reset: () => void;
}

export const useSkillPackStore = create<SkillPackState>((set, get) => ({
  workspaceId: undefined,
  items: [],
  checkedAt: undefined,
  phase: "idle",
  error: undefined,

  begin(workspaceId, phase) {
    set((state) => ({
      workspaceId,
      phase,
      error: undefined,
      ...(state.workspaceId === workspaceId ? {} : { items: [], checkedAt: undefined })
    }));
  },

  install(workspaceId, items, checkedAt) {
    if (get().workspaceId !== workspaceId) return;
    set({
      items,
      phase: "idle",
      error: undefined,
      ...(checkedAt === undefined ? {} : { checkedAt })
    });
  },

  invalidate(workspaceId, id, error) {
    if (get().workspaceId !== workspaceId) return;
    set((state) => ({
      items: state.items.map((item) => item.id === id ? {
        ...item,
        updateStatus: "unavailable",
        localState: "unknown",
        canUpdate: false,
        detail: error
      } : item)
    }));
  },

  fail(workspaceId, error) {
    if (get().workspaceId !== workspaceId) return;
    set({ phase: "failed", error });
  },

  reset() {
    set({
      workspaceId: undefined,
      items: [],
      checkedAt: undefined,
      phase: "idle",
      error: undefined
    });
  }
}));
