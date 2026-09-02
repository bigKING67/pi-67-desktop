import {
  MessageChannelMain,
  type BrowserWindow,
  type UtilityProcess
} from "electron";
import type { AgentHostStartupState } from "@pi67/protocol";
import { rendererDocumentHandoffKey } from "./agent-host-supervisor-contract.js";
import { isExpectedRendererLocation } from "./renderer-security.js";

export function handoffAgentHostPort(input: {
  host: UtilityProcess;
  window: BrowserWindow | undefined;
  identity: { hostEpoch: number; hostInstanceId: string };
  appInstanceId: string;
  expectedRendererOrigin: string;
  rendererUrl: string;
  currentStartup?: AgentHostStartupState;
  lastHandoffKey?: string;
  replaceCurrent: boolean;
}): string | undefined {
  const window = input.window;
  if (!window || window.isDestroyed()) return undefined;
  if (!isExpectedRendererLocation(window.webContents.getURL(), input.rendererUrl)) return undefined;
  const handoffKey = rendererDocumentHandoffKey(window, input.identity.hostEpoch);
  if (!handoffKey || (!input.replaceCurrent && handoffKey === input.lastHandoffKey)) return undefined;

  const { port1, port2 } = new MessageChannelMain();
  input.host.postMessage({
    type: "attach-port",
    appInstanceId: input.appInstanceId,
    hostInstanceId: input.identity.hostInstanceId,
    hostEpoch: input.identity.hostEpoch
  }, [port1]);
  window.webContents.postMessage("pi67:agent-port", {
    expectedOrigin: input.expectedRendererOrigin,
    appInstanceId: input.appInstanceId,
    hostEpoch: input.identity.hostEpoch
  }, [port2]);
  if (input.currentStartup) {
    window.webContents.send("pi67:agent-host-startup", {
      hostEpoch: input.identity.hostEpoch,
      startup: input.currentStartup
    });
  }
  return handoffKey;
}
