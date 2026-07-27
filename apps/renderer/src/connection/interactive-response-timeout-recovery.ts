import { ProtocolRequestError } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { resynchronizeRendererProjection } from "./projection-recovery-controller.js";

type InteractiveResponseKind = "approval" | "extension";

interface InteractiveResponseTimeoutRecoveryOptions {
  kind: InteractiveResponseKind;
  hostEpoch: number;
  operationId?: string;
}

export async function recoverInteractiveResponseTimeout(
  error: unknown,
  options: InteractiveResponseTimeoutRecoveryOptions
): Promise<boolean> {
  if (!(error instanceof ProtocolRequestError) || error.code !== "REQUEST_TIMEOUT") return false;
  const state = useAppStore.getState();
  if (
    !state.connected
    || state.hostEpoch !== options.hostEpoch
    || (options.operationId !== undefined && state.operation?.operationId !== options.operationId)
  ) return false;

  const presentation = options.kind === "approval"
    ? messages.approval.responseTimeout
    : messages.extensionUi.responseTimeout;
  publishNotification({
    level: "warning",
    title: presentation.title,
    message: presentation.message
  });
  await resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
    hostEpoch: options.hostEpoch,
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    recoveringDetail: presentation.recoveringDetail,
    readyDetail: presentation.readyDetail,
    failureTitle: presentation.failureTitle
  });
  return true;
}
