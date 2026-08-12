import type { OperationKind } from "@pi67/domain";
import type { ProtocolError } from "./protocol-error.js";

export interface OperationAccepted {
  kind: "accepted";
  operationId: string;
  cancellable: boolean;
  hostEpoch: number;
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
}

interface OperationSettledBase {
  kind: "settled";
  operationId: string;
  operationKind: OperationKind;
  cancellable: false;
  hostEpoch: number;
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
  startedAt: number;
  settledAt: number;
}

export type OperationSettled = OperationSettledBase & (
  | { lifecycle: "completed" }
  | { lifecycle: "failed"; error: ProtocolError }
  | { lifecycle: "cancelled" | "lost"; reason: string }
);

export type OperationSubmissionResult = OperationAccepted | OperationSettled;

export function isOperationSettled(result: OperationSubmissionResult): result is OperationSettled {
  return result.kind === "settled";
}
