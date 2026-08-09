import {
  isAgentHostShutdownRequest,
  type AgentHostRuntimePoisonedMessage,
  type AgentHostShutdownCompleteMessage,
  type ProtocolPort
} from "@pi67/protocol";
import { existsSync } from "node:fs";
import { isAttachPortMessage } from "./connection-context.js";
import { bootstrapDesktopCapabilities } from "./desktop-capability-bootstrap.js";
import { AgentHostServer } from "./host-server.js";
import { resolveAgentDirectory } from "./host-task-runtime-lifecycle.js";
import { createPromptAttachmentAccessOwner } from "./prompt-attachment-access.js";
import { removeRetiredTeamMcpConfig } from "./retired-team-mcp-cleanup.js";

interface ParentMessageEvent {
  data: unknown;
  ports: ProtocolPort[];
}

interface UtilityParentPort {
  on(type: "message", listener: (event: ParentMessageEvent) => void): void;
  postMessage(message: AgentHostRuntimePoisonedMessage | AgentHostShutdownCompleteMessage): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;
if (!parentPort) throw new Error("Pi-67 Agent Host must run as an Electron utility process.");

const agentDir = resolveAgentDirectory(undefined);
process.env.PI67_AGENT_PROFILE_FRESH = existsSync(agentDir) ? "0" : "1";
await bootstrapDesktopCapabilities({
  agentDir
});
const retiredTeamMcpCleanup = await removeRetiredTeamMcpConfig({
  agentDir
});
if (retiredTeamMcpCleanup.status === "revision-conflict") {
  throw new Error("Agent Host cannot start while retired Team MCP configuration cleanup conflicts with an external edit.");
}

const promptAttachments = createPromptAttachmentAccessOwner(process.env.PI67_PROMPT_ATTACHMENT_ROOT);
const server = new AgentHostServer(undefined, {
  ...(promptAttachments === undefined ? {} : { promptAttachments }),
  onRuntimePoisoned: (message) => schedulePoisonedRuntimeExit(message),
  onRuntimeInitializationObservation: (observation) => {
    process.stderr.write(`[agent-host:init] ${JSON.stringify(observation)}\n`);
  }
});
let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;
let poisonedRuntimeExitScheduled = false;

parentPort.on("message", (event) => {
  if (isAgentHostShutdownRequest(event.data)) {
    void shutdown(event.data.deadlineMs, true);
    return;
  }
  if (!isAttachPortMessage(event.data) || event.ports.length !== 1) return;
  const port = event.ports[0];
  if (!port) return;
  if (shuttingDown) {
    port.close?.();
    return;
  }
  server.attachPort(port, event.data);
});

function shutdown(deadlineMs = 1_000, notifyParent = false): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = server.shutdown(deadlineMs)
    .then((result) => {
      if (notifyParent) {
        parentPort!.postMessage({ type: "agent-host-shutdown-complete", ...result });
      }
      scheduleExit(0);
    })
    .catch(() => {
      scheduleExit(70);
    });
  return shutdownPromise;
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
process.once("beforeExit", () => void shutdown());

function schedulePoisonedRuntimeExit(message: AgentHostRuntimePoisonedMessage): void {
  if (shuttingDown || poisonedRuntimeExitScheduled) return;
  poisonedRuntimeExitScheduled = true;
  try {
    parentPort!.postMessage(message);
  } finally {
    const forcedExit = setTimeout(() => process.exit(70), 250);
    forcedExit.unref();
  }
}

function scheduleExit(code: number): void {
  setImmediate(() => process.exit(code));
}
