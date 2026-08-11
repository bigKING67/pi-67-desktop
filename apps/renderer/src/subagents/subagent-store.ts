import type { NativeSubagentView } from "@pi67/domain";
import { create } from "zustand";

interface TaskSubagentRoster {
  sessionId: string;
  sessionGeneration: number;
  items: NativeSubagentView[];
}

interface SubagentStoreState {
  byTaskId: Record<string, TaskSubagentRoster>;
  replace: (
    taskId: string,
    sessionId: string,
    sessionGeneration: number,
    items: NativeSubagentView[]
  ) => void;
  upsert: (
    taskId: string,
    sessionId: string,
    sessionGeneration: number,
    item: NativeSubagentView
  ) => void;
  clear: (taskId: string) => void;
}

export const useSubagentStore = create<SubagentStoreState>((set) => ({
  byTaskId: {},
  replace: (taskId, sessionId, sessionGeneration, items) => {
    set((state) => {
      const current = state.byTaskId[taskId];
      const merged = current?.sessionId === sessionId
        && current.sessionGeneration === sessionGeneration
        ? mergeItems(current.items, items)
        : items;
      return {
        byTaskId: {
          ...state.byTaskId,
          [taskId]: {
            sessionId,
            sessionGeneration,
            items: sortItems(merged)
          }
        }
      };
    });
  },
  upsert: (taskId, sessionId, sessionGeneration, item) => {
    set((state) => {
      const current = state.byTaskId[taskId];
      const items = current?.sessionId === sessionId
        && current.sessionGeneration === sessionGeneration
        ? current.items
        : [];
      return {
        byTaskId: {
          ...state.byTaskId,
          [taskId]: {
            sessionId,
            sessionGeneration,
            items: sortItems(mergeItems(items, [item]))
          }
        }
      };
    });
  },
  clear: (taskId) => {
    set((state) => {
      if (state.byTaskId[taskId] === undefined) return state;
      const byTaskId = { ...state.byTaskId };
      delete byTaskId[taskId];
      return { byTaskId };
    });
  }
}));

function sortItems(items: readonly NativeSubagentView[]): NativeSubagentView[] {
  return [...items].sort((left, right) => {
    if (left.depth !== right.depth) return left.depth - right.depth;
    return left.updatedAt - right.updatedAt;
  });
}

function mergeItems(
  current: readonly NativeSubagentView[],
  incoming: readonly NativeSubagentView[]
): NativeSubagentView[] {
  const byRunId = new Map(current.map((item) => [item.runId, item]));
  for (const item of incoming) {
    const existing = byRunId.get(item.runId);
    if (!existing || item.updatedAt > existing.updatedAt) byRunId.set(item.runId, item);
  }
  return [...byRunId.values()];
}
