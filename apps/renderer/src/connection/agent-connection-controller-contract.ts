import type {
  AgentConnectionIdentity,
  AgentEvent,
  EventEnvelope,
  ProtocolContext,
  SequenceGap
} from "@pi67/protocol";

export interface ConnectionSubscriber {
  onConnected?: (identity: AgentConnectionIdentity) => void;
  onEvent?: (event: AgentEvent, envelope: EventEnvelope) => void;
  onSequenceGap?: (gap: SequenceGap) => void;
  onTeardown?: (error: Error) => void;
}

export interface AgentConnectionRequestOptions {
  context?: ProtocolContext;
  onAcknowledgementDelayed?: () => void;
  ackTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface AgentConnectionControllerOptions {
  now?: () => number;
  slowAcknowledgementThresholdMs?: number;
}
