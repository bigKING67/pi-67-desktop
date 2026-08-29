import type { AgentCommandType } from "./agent-messages.js";
import type { ProtocolContext } from "./envelope.js";
import {
  releaseRequestAbort,
  type RequestAbortBinding
} from "./port-request-cancellation.js";

export type PortEventType = "message" | "messageerror" | "close";
export type PortListener = (event: unknown) => void;

export interface ProtocolPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  start?(): void;
  close?(): void;
  addEventListener?(type: PortEventType, listener: PortListener): void;
  removeEventListener?(type: PortEventType, listener: PortListener): void;
  on?(type: PortEventType, listener: PortListener): void;
  off?(type: PortEventType, listener: PortListener): void;
}

export interface PendingPortRequest {
  type: AgentCommandType;
  context: ProtocolContext;
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  abort?: RequestAbortBinding;
  sent: boolean;
}

export function releasePendingPortRequest(pending: PendingPortRequest): void {
  clearTimeout(pending.timeout);
  releaseRequestAbort(pending.abort);
}
