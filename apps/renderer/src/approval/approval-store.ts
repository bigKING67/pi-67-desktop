import type { ApprovalRequestView } from "@pi67/domain";
import { create } from "zustand";

interface ApprovalState {
  requests: ApprovalRequestView[];
  upsertRequest: (request: ApprovalRequestView) => void;
  removeRequest: (requestId: string) => void;
  removeRequestIfCurrent: (request: ApprovalRequestView) => boolean;
  removeRequests: (requestIds: string[]) => void;
  reset: () => void;
}

export const useApprovalStore = create<ApprovalState>((set) => ({
  requests: [],

  upsertRequest(request) {
    set((state) => {
      const index = state.requests.findIndex((candidate) => candidate.requestId === request.requestId);
      if (index === -1) return { requests: [...state.requests, request] };
      if (state.requests[index] === request) return state;
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

  removeRequests(requestIds) {
    if (requestIds.length === 0) return;
    const removed = new Set(requestIds);
    set((state) => {
      const requests = state.requests.filter((request) => !removed.has(request.requestId));
      return requests.length === state.requests.length ? state : { requests };
    });
  },

  reset() {
    set({ requests: [] });
  }
}));

export function resetApprovalState(): void {
  useApprovalStore.getState().reset();
}
