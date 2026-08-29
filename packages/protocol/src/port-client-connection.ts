import {
  ProtocolRequestError,
  type ProtocolError
} from "./agent-messages.js";
import type { HostWelcome } from "./envelope.js";

interface PortMessageEvent {
  data: unknown;
}

export interface AgentConnectionIdentity {
  appInstanceId: string;
  hostInstanceId: string;
  hostEpoch: number;
  sdkVersion: string;
  eventSequence: number;
}

export interface SequenceGap {
  expected: number;
  received: number;
  hostEpoch: number;
}

export function extractPortEventData(event: unknown): unknown {
  return typeof event === "object" && event !== null && "data" in event
    ? (event as PortMessageEvent).data
    : event;
}

export function toAgentConnectionIdentity(welcome: HostWelcome): AgentConnectionIdentity {
  return {
    appInstanceId: welcome.appInstanceId,
    hostInstanceId: welcome.hostInstanceId,
    hostEpoch: welcome.hostEpoch,
    sdkVersion: welcome.sdkVersion,
    eventSequence: welcome.eventSequence
  };
}

export function agentConnectionError(message: string): ProtocolRequestError {
  const error: ProtocolError = { code: "CONNECTION_CLOSED", message, recoverable: true };
  return new ProtocolRequestError(error);
}
