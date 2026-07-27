import { agentConnectionController } from "../connection/AgentConnectionController.js";
import {
  hasCurrentInteractiveAuthority,
  type InteractiveAuthorityState
} from "../connection/interactive-authority.js";
import { recoverInteractiveResponseTimeout } from "../connection/interactive-response-timeout-recovery.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useExtensionUiStore } from "./extension-ui-store.js";

export async function respondToExtensionUi(
  getAuthority: () => InteractiveAuthorityState,
  requestId: string,
  value?: string | boolean,
  cancelled?: boolean
): Promise<boolean> {
  const request = useExtensionUiStore.getState().requests.find(
    (candidate) => candidate.requestId === requestId
  );
  if (
    !request
    || request.hostEpoch === undefined
    || request.sessionId === undefined
    || request.sessionGeneration === undefined
    || !hasCurrentInteractiveAuthority(getAuthority(), request)
  ) {
    if (request) useExtensionUiStore.getState().removeRequestIfCurrent(request);
    publishNotification({
      level: "warning",
      title: messages.extensionUi.staleTitle,
      message: messages.extensionUi.staleBeforeSend
    });
    return false;
  }

  try {
    const result = await agentConnectionController.request("extension.ui.respond", {
      requestId,
      sessionId: request.sessionId,
      sessionGeneration: request.sessionGeneration,
      ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
      ...(value === undefined ? {} : { value }),
      ...(cancelled === undefined ? {} : { cancelled })
    });
    useExtensionUiStore.getState().removeRequestIfCurrent(request);
    if (result.resolved) return true;
    publishNotification({
      level: "warning",
      title: messages.extensionUi.staleTitle,
      message: messages.extensionUi.staleRejected
    });
    return false;
  } catch (error) {
    if (await recoverInteractiveResponseTimeout(error, {
      kind: "extension",
      hostEpoch: request.hostEpoch,
      ...(request.operationId === undefined ? {} : { operationId: request.operationId })
    })) return false;
    publishNotification({
      level: "error",
      title: messages.extensionUi.submitFailed,
      message: messages.extensionUi.submitRetry(errorMessage(error))
    });
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.extensionUi.connectionError;
}
