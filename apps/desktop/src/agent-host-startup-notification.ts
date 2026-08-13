import type { BrowserWindow } from "electron";
import type {
  AgentHostStartupFailedMessage,
  DesktopAgentHostFailureState
} from "@pi67/protocol";
import { rendererDocumentHandoffKey } from "./agent-host-supervisor-contract.js";
import { isExpectedRendererLocation } from "./renderer-security.js";

export function sendAgentHostStartupFailure(options: {
  window: BrowserWindow | undefined;
  rendererUrl: string;
  lastNotificationKey: string | undefined;
  failure: { hostEpoch: number; message: AgentHostStartupFailedMessage };
}): string | undefined {
  const { failure, window } = options;
  if (!window || window.isDestroyed()) return options.lastNotificationKey;
  if (!isExpectedRendererLocation(window.webContents.getURL(), options.rendererUrl)) {
    return options.lastNotificationKey;
  }
  const documentKey = rendererDocumentHandoffKey(window, failure.hostEpoch);
  if (!documentKey || documentKey === options.lastNotificationKey) return options.lastNotificationKey;
  const payload: DesktopAgentHostFailureState = {
    hostEpoch: failure.hostEpoch,
    code: 1,
    recoverable: false,
    startupFailure: failure.message
  };
  window.webContents.send("pi67:agent-host-failed", payload);
  return documentKey;
}
