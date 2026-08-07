import type {
  OperationKind,
  OperationView,
  RuntimeIdentity
} from "@pi67/domain";
import {
  createMessageId,
  type OperationAccepted
} from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";

export type OperationSessionIdentity = RuntimeIdentity & {
  sessionId: string;
  sessionFileIdentity: string;
};

export function requireOperationSessionIdentity(
  identity: RuntimeIdentity
): OperationSessionIdentity {
  if (!identity.sessionId || !identity.sessionFileIdentity) {
    throw new HostCommandError(
      "RUNTIME_NOT_READY",
      "Pi SDK runtime has no authoritative physical Session identity."
    );
  }
  return {
    ...identity,
    sessionId: identity.sessionId,
    sessionFileIdentity: identity.sessionFileIdentity
  };
}

export function createOperationView(
  identity: OperationSessionIdentity,
  kind: OperationKind,
  cancellable: boolean,
  startedAt: number
): OperationView {
  return {
    operationId: createMessageId("operation"),
    kind,
    lifecycle: "running",
    cancellable,
    sessionId: identity.sessionId,
    sessionFileIdentity: identity.sessionFileIdentity,
    sessionGeneration: identity.sessionGeneration,
    startedAt
  };
}

export function acceptedOperation(
  view: OperationView,
  hostEpoch: number
): OperationAccepted {
  return {
    kind: "accepted",
    operationId: view.operationId,
    cancellable: view.cancellable,
    hostEpoch,
    sessionId: view.sessionId,
    sessionFileIdentity: view.sessionFileIdentity,
    sessionGeneration: view.sessionGeneration
  };
}
