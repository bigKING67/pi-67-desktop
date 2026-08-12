import { conversationKeyIdentity } from "@pi67/domain";
import { rendererWorkbenchStore } from "./workbench-store.js";

export function captureDraftRestoreSelectionGuard(): { release(): boolean } {
  const initialSelection = workbenchSelectionIdentity();
  let selectionChanged = false;
  let released = false;
  const unsubscribe = rendererWorkbenchStore.subscribe(() => {
    if (workbenchSelectionIdentity() !== initialSelection) selectionChanged = true;
  });
  return {
    release() {
      if (!released) {
        released = true;
        unsubscribe();
      }
      return !selectionChanged && workbenchSelectionIdentity() === initialSelection;
    }
  };
}

function workbenchSelectionIdentity(): string {
  const surface = rendererWorkbenchStore.getState().selectedSurface;
  if (!surface) return "none";
  if (surface.kind === "settings") return "settings";
  if (surface.kind === "workspace") return `workspace:${surface.workspaceId}`;
  return `conversation:${conversationKeyIdentity(surface.conversation)}`;
}
