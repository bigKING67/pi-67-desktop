import {
  isAgentHostShutdownRequest,
  type AgentHostRuntimePoisonedMessage,
  type AgentHostShutdownCompleteMessage,
  type ProtocolPort
} from "@pi67/protocol";
import { isAttachPortMessage } from "./connection-context.js";
import { AgentHostServer } from "./host-server.js";

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

const server = new AgentHostServer(undefined, {
  onRuntimePoisoned: (message) => schedulePoisonedRuntimeExit(message)
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
