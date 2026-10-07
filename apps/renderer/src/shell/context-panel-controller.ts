import { DESKTOP_CONTEXT_DRAWER_MAX_WIDTH } from "@pi67/protocol";
import { writeInspectorDockedPreference } from "./inspector-preference.js";
import { useShellStore } from "./shell-store.js";

export const CONTEXT_DRAWER_MEDIA_QUERY = `(max-width: ${DESKTOP_CONTEXT_DRAWER_MAX_WIDTH}px)`;

interface ContextPanelDependencies {
  drawerMatches: () => boolean;
  ensureRoom: () => Promise<boolean>;
  reportExpansionFailure: () => void;
}

export async function toggleRendererContext(
  dependencies: ContextPanelDependencies = defaultDependencies()
): Promise<void> {
  const shell = useShellStore.getState();
  // Only the work-mode docked Inspector owns a remembered choice; chat mode renders none.
  const remember = shell.workspaceMode === "work";
  const drawer = dependencies.drawerMatches();
  if (shell.contextVisible) {
    shell.setContextVisible(false);
    if (remember && !drawer) writeInspectorDockedPreference(false);
    return;
  }
  if (!drawer) {
    if (remember) writeInspectorDockedPreference(true);
  } else {
    try {
      // A widened window docks the Inspector, so that open becomes the remembered choice.
      if (await dependencies.ensureRoom() && remember) writeInspectorDockedPreference(true);
    } catch {
      dependencies.reportExpansionFailure();
    }
  }
  useShellStore.getState().setContextVisible(true);
}

function defaultDependencies(): ContextPanelDependencies {
  return {
    drawerMatches: () => (
      typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia(CONTEXT_DRAWER_MEDIA_QUERY).matches
    ),
    ensureRoom: () => window.pi67.system.ensureContextPanelRoom(),
    reportExpansionFailure: () => console.warn("Context panel window expansion failed; using the drawer.")
  };
}
