import type { OperationLifecycle, OperationView } from "@pi67/domain";
import { create } from "zustand";

const TARGET_CHUNK_CHARACTERS = 16 * 1024;

interface LiveTurnAuthority {
  hostEpoch?: number;
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
}

interface LiveTurnState {
  authority: LiveTurnAuthority | undefined;
  textChunks: string[];
  thinkingChunks: string[];
  revision: number;
  begin: (operation: OperationView, hostEpoch?: number) => void;
  append: (delta: { text: string; thinking: string }, authority: LiveTurnAuthority) => boolean;
  finish: (operationId: string, lifecycle: OperationLifecycle) => void;
  settle: (operationId?: string) => void;
  reset: () => void;
}

export const useLiveTurnStore = create<LiveTurnState>((set, get) => ({
  authority: undefined,
  textChunks: [],
  thinkingChunks: [],
  revision: 0,

  begin(operation, hostEpoch) {
    set((state) => ({
      authority: {
        ...(hostEpoch === undefined ? {} : { hostEpoch }),
        ...(operation.sessionId === undefined ? {} : { sessionId: operation.sessionId }),
        ...(operation.sessionGeneration === undefined ? {} : { sessionGeneration: operation.sessionGeneration }),
        operationId: operation.operationId
      },
      textChunks: [],
      thinkingChunks: [],
      revision: state.revision + 1
    }));
  },

  append(delta, authority) {
    const state = get();
    if (state.authority && !matchesAuthority(state.authority, authority)) return false;
    if (!delta.text && !delta.thinking) return true;
    set({
      authority: state.authority ?? authority,
      textChunks: appendChunk(state.textChunks, delta.text),
      thinkingChunks: appendChunk(state.thinkingChunks, delta.thinking),
      revision: state.revision + 1
    });
    return true;
  },

  finish(operationId, lifecycle) {
    const state = get();
    if (state.authority?.operationId !== operationId) return;
    if (lifecycle === "completed") return;
    state.reset();
  },

  settle(operationId) {
    const state = get();
    if (
      state.authority?.operationId !== undefined
      && operationId !== state.authority.operationId
    ) return;
    state.reset();
  },

  reset() {
    set((state) => ({
      authority: undefined,
      textChunks: [],
      thinkingChunks: [],
      revision: state.revision + 1
    }));
  }
}));

function appendChunk(chunks: string[], delta: string): string[] {
  if (!delta) return chunks;
  const last = chunks.at(-1);
  if (last !== undefined && last.length + delta.length <= TARGET_CHUNK_CHARACTERS) {
    return [...chunks.slice(0, -1), `${last}${delta}`];
  }
  return [...chunks, delta];
}

function matchesAuthority(current: LiveTurnAuthority, incoming: LiveTurnAuthority): boolean {
  return matchesOptional(current.hostEpoch, incoming.hostEpoch)
    && matchesOptional(current.sessionId, incoming.sessionId)
    && matchesOptional(current.sessionGeneration, incoming.sessionGeneration)
    && matchesOptional(current.operationId, incoming.operationId);
}

function matchesOptional<T>(current: T | undefined, incoming: T | undefined): boolean {
  return current === undefined || incoming === undefined || current === incoming;
}
