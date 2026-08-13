import {
  ProtocolRequestError,
  type DesktopAgentHostFailureState,
  type DesktopAgentHostStartupState
} from "@pi67/protocol";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";

let deterministicFailureHostEpoch: number | undefined;
const notifiedDegradedHostEpochs = new Set<number>();

export function observeAgentHostStartup(state: DesktopAgentHostStartupState): void {
  if (
    deterministicFailureHostEpoch !== undefined
    && state.hostEpoch >= deterministicFailureHostEpoch
  ) deterministicFailureHostEpoch = undefined;
  if (state.startup.status !== "degraded" || notifiedDegradedHostEpochs.has(state.hostEpoch)) return;
  notifiedDegradedHostEpochs.add(state.hostEpoch);
  publishNotification({
    level: "warning",
    title: messages.runtime.connection.hostStartedDegradedTitle,
    message: messages.runtime.connection.hostStartedDegradedDetail
  });
}

export function observeAgentHostFailure(state: DesktopAgentHostFailureState): boolean {
  if (!state.startupFailure) return false;
  deterministicFailureHostEpoch = state.hostEpoch;
  return true;
}

export function shouldSuppressAgentHostFollowup(error: unknown): boolean {
  if (deterministicFailureHostEpoch === undefined) return false;
  if (error instanceof ProtocolRequestError) {
    return error.code === "CONNECTION_CLOSED"
      || error.code === "RUNTIME_NOT_READY"
      || error.code === "STALE_HOST_EPOCH";
  }
  const message = error instanceof Error ? error.message : "";
  return /运行服务.*(?:尚未连接|连接.*失败)|runtime service connection/iu.test(message);
}

export function resetAgentHostStartupStateForTest(): void {
  deterministicFailureHostEpoch = undefined;
  notifiedDegradedHostEpochs.clear();
}
