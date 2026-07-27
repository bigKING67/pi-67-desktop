import type { AgentRuntime } from "@pi67/pi-runtime";
import type {
  CommandResults,
  ProjectionMutationAcknowledgement
} from "@pi67/protocol";
import type { OperationRegistry } from "./operation-registry.js";

export function captureProjectionResync(
  runtime: AgentRuntime,
  eventSequence: number,
  hostEpoch: number,
  operations: OperationRegistry | undefined
): CommandResults["projection.resync"] {
  const identity = runtime.getIdentity();
  const activeOperation = operations?.activeView();
  const latestOperationTerminal = operations?.latestTerminal();
  return {
    snapshot: runtime.getSnapshot(),
    changes: runtime.getWorkspaceChanges(),
    extensionCatalog: runtime.getExtensionCatalog(),
    sessionCatalogStatus: runtime.getSessionCatalogStatus(),
    eventSequence,
    hostEpoch,
    sessionGeneration: identity.sessionGeneration,
    ...(activeOperation === undefined ? {} : { activeOperation }),
    ...(latestOperationTerminal === undefined ? {} : { latestOperationTerminal })
  };
}

export function captureProjectionMutationAcknowledgement(
  runtime: AgentRuntime,
  eventSequence: number,
  hostEpoch: number
): ProjectionMutationAcknowledgement {
  const identity = runtime.getIdentity();
  if (!identity.sessionId) {
    throw new Error("Pi SDK runtime is not initialized.");
  }
  return {
    accepted: true,
    hostEpoch,
    sessionId: identity.sessionId,
    sessionGeneration: identity.sessionGeneration,
    eventSequence
  };
}
