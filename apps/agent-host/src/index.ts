import {
  isAgentHostShutdownRequest,
  isEnterpriseCredentialBootstrapMessage,
  isEnterpriseCredentialOperationResult,
  type AgentHostReadyMessage,
  type AgentHostRuntimePoisonedMessage,
  type AgentHostShutdownCompleteMessage,
  type AgentHostStartupFailedMessage,
  type EnterpriseCredentialClearRequest,
  type EnterpriseCredentialStoreRequest,
  type ProtocolPort
} from "@pi67/protocol";
import {
  AgentHostStartupError,
  coordinateAgentHostStartup
} from "./agent-host-startup.js";
import { isAttachPortMessage } from "./connection-context.js";
import { AgentHostServer } from "./host-server.js";
import { resolveAgentDirectory } from "./host-task-runtime-lifecycle.js";
import { createPromptAttachmentAccessOwner } from "./prompt-attachment-access.js";
import { EnterpriseCredentialBrokerClient } from "./context/enterprise-credential-broker-client.js";

interface ParentMessageEvent {
  data: unknown;
  ports: ProtocolPort[];
}

interface UtilityParentPort {
  on(type: "message", listener: (event: ParentMessageEvent) => void): void;
  postMessage(
    message:
      | AgentHostReadyMessage
      | AgentHostRuntimePoisonedMessage
      | AgentHostShutdownCompleteMessage
      | AgentHostStartupFailedMessage
      | EnterpriseCredentialStoreRequest
      | EnterpriseCredentialClearRequest
  ): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;
if (!parentPort) throw new Error("Pi-67 Agent Host must run as an Electron utility process.");
const enterpriseCredentialBroker = new EnterpriseCredentialBrokerClient(parentPort);

let poisonedRuntimeExitScheduled = false;

void startAgentHost();

async function startAgentHost(): Promise<void> {
  let started;
  let shuttingDown = false;
  try {
    const agentDir = resolveAgentDirectory(undefined);
    started = await coordinateAgentHostStartup({
      agentDir,
      constructServer: () => {
        const promptAttachments = createPromptAttachmentAccessOwner(
          process.env.PI67_PROMPT_ATTACHMENT_ROOT
        );
        return new AgentHostServer(undefined, {
          agentDir,
          ...(promptAttachments === undefined ? {} : { promptAttachments }),
          onRuntimePoisoned: (message) => schedulePoisonedRuntimeExit(message, () => shuttingDown),
          onRuntimeInitializationObservation: (observation) => {
            process.stderr.write(`[agent-host:init] ${JSON.stringify(observation)}\n`);
          },
          enterpriseCredentialBroker
        });
      }
    });
  } catch (error) {
    const failure = error instanceof AgentHostStartupError
      ? error
      : new AgentHostStartupError({ stage: "server-construction", code: "unknown" });
    parentPort!.postMessage({
      type: "agent-host-startup-failed",
      ...(failure.profileMode === undefined ? {} : { profileMode: failure.profileMode }),
      issue: failure.issue
    });
    scheduleExit(1);
    return;
  }

  const { server, startup } = started;
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (deadlineMs = 1_000, notifyParent = false): Promise<void> => {
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
  };

  parentPort!.on("message", (event) => {
    if (isEnterpriseCredentialBootstrapMessage(event.data)) {
      enterpriseCredentialBroker.applyBootstrap(event.data);
      return;
    }
    if (isEnterpriseCredentialOperationResult(event.data)) {
      enterpriseCredentialBroker.handleOperationResult(event.data);
      return;
    }
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
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  process.once("beforeExit", () => void shutdown());
  parentPort!.postMessage({ type: "agent-host-ready", startup });
}

function schedulePoisonedRuntimeExit(
  message: AgentHostRuntimePoisonedMessage,
  isShuttingDown: () => boolean
): void {
  if (isShuttingDown() || poisonedRuntimeExitScheduled) return;
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
