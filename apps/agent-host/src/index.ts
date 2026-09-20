import {
  isAgentHostShutdownRequest,
  isEnterprisePowerTransitionMessage,
  isEnterpriseCredentialBootstrapMessage,
  isEnterpriseCredentialOperationResult,
  type LocalMemoryConnectRequest,
  type LocalMemoryModelResult,
  type AgentHostReadyMessage,
  type AgentHostRuntimePoisonedMessage,
  type AgentHostShutdownCompleteMessage,
  type AgentHostStartupFailedMessage,
  type EnterpriseCredentialClearRequest,
  type EnterpriseCredentialStoreRequest,
  type TeamModelRelayPort
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
import { LocalMemoryBrokerClient, managedLocalMemoryFromEnvironment } from "./context/local-memory-broker-client.js";
import { canonicalTeamKnowledgeFromEnvironment } from "./context/host-team-knowledge.js";
import { enterprisePowerEpoch } from "./context/enterprise-power-epoch.js";
import { TeamWorkerBrokerClient } from "./context/team-worker-broker-client.js";
import { TeamIndexSettingsClient } from "./context/team-index-settings-client.js";
import { TeamIndexHeadResponder } from "./context/team-index-head-responder.js";

interface ParentMessageEvent {
  data: unknown;
  ports: TeamModelRelayPort[];
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
      | LocalMemoryConnectRequest
      | LocalMemoryModelResult
      | import("@pi67/protocol").TeamWorkerRequest
      | import("@pi67/protocol").TeamIndexSettingsRequest
      | import("@pi67/protocol").SharedKnowledgeIndexHeadResult
  ): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;
if (!parentPort) throw new Error("Pi-67 Agent Host must run as an Electron utility process.");
const enterpriseCredentialBroker = new EnterpriseCredentialBrokerClient(parentPort);
const localMemoryBroker = new LocalMemoryBrokerClient(parentPort);
const teamWorkers = new TeamWorkerBrokerClient(parentPort);
const teamIndexSettings = new TeamIndexSettingsClient(parentPort);

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
          enterpriseCredentialBroker,
          localMemoryBroker,
          teamWorkers,
          teamIndexSettings,
          managedLocalMemory: managedLocalMemoryFromEnvironment(process.env),
          canonicalTeamKnowledgeTools: canonicalTeamKnowledgeFromEnvironment(process.env)
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
  const teamIndexHeads = new TeamIndexHeadResponder(parentPort!, (input, signal) =>
    server.observeIndexHead(input, AbortSignal.any([signal, teamIndexSettings.signal])));
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (deadlineMs = 1_000, notifyParent = false): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    teamIndexHeads.shutdown();
    localMemoryBroker.shutdown();
    teamIndexSettings.shutdown();
    enterpriseCredentialBroker.shutdown();
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
    if (teamIndexHeads.handleMessage(event.data)) return;
    if (teamIndexSettings.handleMessage(event.data)) return;
    if (teamWorkers.handleMessage(event.data)) return;
    if (server.teamModelPorts.handleMessage(event)) return;
    if (isEnterprisePowerTransitionMessage(event.data)) { enterprisePowerEpoch.transition(event.data.state); return; }
    if (server.localMemoryModels.handleMessage(event.data, (result) => parentPort!.postMessage(result))) return;
    if (localMemoryBroker.handleResult(event.data)) return;
    if (enterpriseCredentialBroker.handleReceiptResult(event.data)) return;
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
