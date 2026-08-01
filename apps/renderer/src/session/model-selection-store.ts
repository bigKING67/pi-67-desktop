import { create } from "zustand";
import type { RendererSessionAuthority } from "./session-authority.js";
import { useSessionProjectionStore } from "./session-projection-store.js";

export interface ModelSelectionTarget {
  provider: string;
  id: string;
  label: string;
}

type ModelSelectionStatus = "idle" | "pending" | "confirmed" | "failed";

export interface ModelSelectionState {
  revision: number;
  authorityKey: string | undefined;
  target: ModelSelectionTarget | undefined;
  status: ModelSelectionStatus;
  error: string | undefined;
}

export interface ModelSelectionToken {
  revision: number;
  authorityKey: string;
  targetKey: string;
}

const INITIAL_MODEL_SELECTION_STATE: ModelSelectionState = {
  revision: 0,
  authorityKey: undefined,
  target: undefined,
  status: "idle",
  error: undefined
};

export const useModelSelectionStore = create<ModelSelectionState>(() => ({
  ...INITIAL_MODEL_SELECTION_STATE
}));

export function beginModelSelection(
  authority: RendererSessionAuthority,
  target: ModelSelectionTarget
): ModelSelectionToken {
  const current = useModelSelectionStore.getState();
  const revision = current.revision + 1;
  const authorityKey = modelSelectionAuthorityKey(authority);
  const targetKey = `${target.provider}/${target.id}`;
  useModelSelectionStore.setState({
    revision,
    authorityKey,
    target,
    status: "pending",
    error: undefined
  });
  return { revision, authorityKey, targetKey };
}

export function confirmModelSelection(token: ModelSelectionToken): boolean {
  const current = useModelSelectionStore.getState();
  if (
    (current.status !== "pending" && current.status !== "failed")
    || !matchesModelSelectionToken(current, token)
  ) return false;
  useModelSelectionStore.setState({ status: "confirmed", error: undefined });
  return true;
}

export function failModelSelection(token: ModelSelectionToken, error: string): boolean {
  if (!isPendingModelSelection(token)) return false;
  useModelSelectionStore.setState({ status: "failed", error });
  return true;
}

export function isPendingModelSelection(token: ModelSelectionToken): boolean {
  const current = useModelSelectionStore.getState();
  return current.status === "pending" && matchesModelSelectionToken(current, token);
}

export function resetModelSelection(): void {
  const current = useModelSelectionStore.getState();
  useModelSelectionStore.setState({
    ...INITIAL_MODEL_SELECTION_STATE,
    revision: current.revision + 1
  });
}

export function modelSelectionTargetKey(
  target: Pick<ModelSelectionTarget, "provider" | "id"> | undefined
): string | undefined {
  return target ? `${target.provider}/${target.id}` : undefined;
}

function modelSelectionAuthorityKey(
  authority: Pick<RendererSessionAuthority, "hostEpoch" | "sessionId" | "sessionGeneration">
): string {
  return `${authority.hostEpoch}:${authority.sessionId}:${authority.sessionGeneration}`;
}

function matchesModelSelectionToken(
  selection: ModelSelectionState,
  token: ModelSelectionToken
): boolean {
  return selection.revision === token.revision
    && selection.authorityKey === token.authorityKey
    && modelSelectionTargetKey(selection.target) === token.targetKey;
}

useSessionProjectionStore.subscribe((state) => {
  const selection = useModelSelectionStore.getState();
  if (!selection.authorityKey || state.authority.phase !== "active") return;
  const activeAuthorityKey = modelSelectionAuthorityKey(state.authority);
  if (activeAuthorityKey !== selection.authorityKey) {
    resetModelSelection();
    return;
  }
  const selectedModel = state.controls?.selectedModel;
  const targetKey = modelSelectionTargetKey(selection.target);
  if (
    (selection.status === "pending" || selection.status === "failed")
    && targetKey !== undefined
    && modelSelectionTargetKey(selectedModel) === targetKey
  ) {
    confirmModelSelection({
      revision: selection.revision,
      authorityKey: selection.authorityKey,
      targetKey
    });
  } else if (
    selection.status === "confirmed"
    && modelSelectionTargetKey(selectedModel) !== targetKey
  ) {
    resetModelSelection();
  }
});
