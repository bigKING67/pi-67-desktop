import type { OperationFreshness } from "@pi67/domain";
import { create } from "zustand";

interface OperationFreshnessState {
  freshness: OperationFreshness | undefined;
  setFreshness: (freshness: OperationFreshness) => void;
  clear: () => void;
}

export const useOperationFreshnessStore = create<OperationFreshnessState>((set) => ({
  freshness: undefined,
  setFreshness: (freshness) => set({ freshness }),
  clear: () => set({ freshness: undefined })
}));
