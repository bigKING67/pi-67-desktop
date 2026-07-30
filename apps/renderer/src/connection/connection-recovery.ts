import type { ApprovalMode, WorkspaceTrust } from "@pi67/domain";
import type {
  AgentConnectionIdentity,
  ProjectionMutationAcknowledgement,
  ProjectionResyncInstaller,
  SequenceGap
} from "@pi67/protocol";
import { agentConnectionController } from "./AgentConnectionController.js";

const CONNECTION_ATTEMPT_DELAYS_MS = [0, 150, 500, 1_500, 3_000] as const;
const CONNECTION_ATTEMPT_TIMEOUT_MS = 8_000;

let connectionFlight: Promise<AgentConnectionIdentity> | undefined;

export interface SessionRecoveryInput {
  workspace: string;
  sessionPath?: string;
  trust: WorkspaceTrust;
  approvalMode: ApprovalMode;
}

export function ensureAgentConnection(): Promise<AgentConnectionIdentity> {
  const identity = agentConnectionController.identity;
  if (identity) return Promise.resolve(identity);
  if (connectionFlight) return connectionFlight;

  const flight = connectWithBoundedRetry();
  connectionFlight = flight;
  void flight.finally(() => {
    if (connectionFlight === flight) connectionFlight = undefined;
  }).catch(() => undefined);
  return flight;
}

export async function recoverSession(
  input: SessionRecoveryInput
): Promise<ProjectionMutationAcknowledgement> {
  return agentConnectionController.request("runtime.initialize", {
    cwd: input.workspace,
    ...(input.sessionPath === undefined ? {} : { sessionPath: input.sessionPath }),
    trust: input.trust,
    approvalMode: input.approvalMode
  });
}

export async function resynchronizeProjection(
  expected: number | SequenceGap,
  install: ProjectionResyncInstaller
): Promise<boolean> {
  const expectedHostEpoch = typeof expected === "number" ? expected : expected.hostEpoch;
  return agentConnectionController.resyncProjection((result) => {
    if (result.hostEpoch !== expectedHostEpoch) {
      throw new Error("Pi 运行服务在状态重同步期间已重启。");
    }
    return install(result);
  });
}

async function connectWithBoundedRetry(): Promise<AgentConnectionIdentity> {
  let lastError: unknown;
  for (const delayMs of CONNECTION_ATTEMPT_DELAYS_MS) {
    const current = agentConnectionController.identity;
    if (current) return current;
    if (agentConnectionController.hasOpenPort) {
      try {
        return await agentConnectionController.waitForConnection(CONNECTION_ATTEMPT_TIMEOUT_MS);
      } catch (error) {
        lastError = error;
      }
    }
    if (delayMs > 0) await delay(delayMs);
    try {
      await window.pi67.system.connectAgentHost({
        replaceCurrent: agentConnectionController.hasReceivedPort
      });
      return await agentConnectionController.waitForConnection(CONNECTION_ATTEMPT_TIMEOUT_MS);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Pi 运行服务连接恢复失败。");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
