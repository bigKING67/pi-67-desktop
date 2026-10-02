import type { ChatNativeNotificationRequest } from "@pi67/domain";
import { runAfterLeavingSettings } from "../settings/settings-leave-guard.js";
import { useShellStore } from "../shell/shell-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { teamChat } from "./team-chat-instance.js";
import { createTeamChatNotifier } from "./team-chat-notifications.js";

let installed: { activated: (conversationId: string | undefined) => void; dispose: () => void } | undefined;

/** Chat is on screen, focused, and showing this conversation (not the activity inbox). */
function isViewing(conversationId: string): boolean {
  if (document.visibilityState !== "visible" || !document.hasFocus()) return false;
  if (useShellStore.getState().workspaceMode !== "chat") return false;
  if (rendererWorkbenchStore.getState().selectedSurface?.kind === "settings") return false;
  const state = teamChat.store.getState();
  return !state.activityOpen && state.selectedConversationId === conversationId;
}

/**
 * Team Chat system notifications (ADR 0006). They never start Agent Host: Team Chat
 * connects whenever Host runs (the controller asks on every Host connection).
 */
export function initializeTeamChatNotifications(): () => void {
  if (installed) return installed.dispose;
  const notifier = createTeamChatNotifier({
    store: teamChat.store,
    show: (request) => window.pi67?.system?.showNativeNotification?.(request) ?? Promise.resolve(false),
    dismiss: (notificationId) => { void window.pi67?.system?.dismissNativeNotification?.(notificationId).catch(() => false); },
    isViewing
  });
  const stopNotifier = notifier.start();
  const stopShell = useShellStore.subscribe(notifier.refresh);
  const stopWorkbench = rendererWorkbenchStore.subscribe(notifier.refresh);
  window.addEventListener("focus", notifier.refresh);
  document.addEventListener("visibilitychange", notifier.refresh);
  const dispose = () => {
    stopNotifier();
    stopShell();
    stopWorkbench();
    window.removeEventListener("focus", notifier.refresh);
    document.removeEventListener("visibilitychange", notifier.refresh);
    installed = undefined;
  };
  installed = { activated: notifier.activated, dispose };
  return dispose;
}

/** A clicked chat notification: leave Settings if allowed, switch to Chat, open the message or the inbox. */
export async function activateTeamChatNotification(activation: ChatNativeNotificationRequest): Promise<boolean> {
  installed?.activated(activation.conversationId);
  return (await runAfterLeavingSettings(async () => {
    if (rendererWorkbenchStore.getState().selectedSurface?.kind === "settings") rendererWorkbenchStore.getState().closeSettings();
    useShellStore.getState().setWorkspaceMode("chat");
    if (activation.conversationId === undefined) teamChat.openActivity();
    else await teamChat.openMessage(activation.conversationId, activation.messageSeq);
    return true;
  })) ?? false;
}
