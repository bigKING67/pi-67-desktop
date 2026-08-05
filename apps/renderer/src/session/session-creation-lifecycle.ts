import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { recheckUnconfirmedRendererSession } from "./session-creation-recovery-controller.js";

export function markRendererSessionCreationUnconfirmed(
  original: RendererWorkbenchTask,
  creationId: string
): boolean {
  const workbench = rendererWorkbenchStore.getState();
  const current = workbench.tasks[original.id];
  if (
    !current
    || current.taskGeneration !== original.taskGeneration
    || current.conversation.kind !== "provisional"
    || current.creationId !== creationId
    || (current.creationStatus !== "pending" && current.creationStatus !== "confirming")
  ) return false;
  const runtime = {
    phase: "failed" as const,
    detail: messages.runtime.session.creationOutcomeUnknown,
    recoverable: true
  };
  workbench.updateTask(current.id, {
    lifecycle: "draft",
    creationStatus: "unconfirmed",
    runtime
  });
  if (
    useAppStore.getState().connected
    && selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id === current.id
  ) {
    useAppStore.setState({
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false,
      runtime
    });
  }
  publishNotification({
    level: "warning",
    title: messages.runtime.session.confirmingCreation,
    message: messages.runtime.session.creationOutcomeUnknown
  });
  if (useAppStore.getState().connected) {
    void recheckUnconfirmedRendererSession(current.id, { notify: false });
  }
  return true;
}
