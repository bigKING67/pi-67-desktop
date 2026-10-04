import {
  MessageChannelMain,
  type BrowserWindow,
  type UtilityProcess
} from "electron";
import type { AgentHostAttachPortMessage, AgentHostOwnerMessage, AgentHostStartupState, DesktopAgentHostStartupState } from "@pi67/protocol";
import { rendererDocumentHandoffKey } from "./agent-host-supervisor-contract.js";
import { isExpectedRendererLocation } from "./renderer-security.js";

/** Main retains this endpoint until this exact utility exits, independently of Renderer ports. */
export function bindAgentHostOwner(host: UtilityProcess): void {
  const { port1, port2 } = new MessageChannelMain();
  try {
    host.postMessage({ type: "agent-host-owner" } satisfies AgentHostOwnerMessage, [port2]);
  } catch (error) {
    port1.close();
    port2.close();
    throw error;
  }
  host.on("exit", () => port1.close());
}

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
  const attachPort: AgentHostAttachPortMessage = {
    type: "attach-port",
    appInstanceId: input.appInstanceId,
    hostInstanceId: input.identity.hostInstanceId,
    hostEpoch: input.identity.hostEpoch
  };
  input.host.postMessage(attachPort, [port1]);
  window.webContents.postMessage("pi67:agent-port", {
    expectedOrigin: input.expectedRendererOrigin,
    appInstanceId: input.appInstanceId,
    hostEpoch: input.identity.hostEpoch
  }, [port2]);
  if (input.currentStartup) {
    window.webContents.send("pi67:agent-host-startup", {
      hostEpoch: input.identity.hostEpoch,
      startup: input.currentStartup
    } satisfies DesktopAgentHostStartupState);
  }
  return handoffKey;
}
