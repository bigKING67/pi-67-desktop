import { BoundedDiagnosticEvidence } from "@pi67/domain";
import {
  ProtocolRequestError,
  type AgentCommandType,
  type RendererConnectionTeardownReason,
  type SupportDiagnosticAction,
  type SupportDiagnosticActionName,
  type SupportDiagnosticActionStage,
  type SupportDiagnosticErrorClass,
  type SupportDiagnosticIncident
} from "@pi67/protocol";

const MAX_RENDERER_ACTIONS = 16;
const MAX_RENDERER_INCIDENTS = 32;

type RendererIncidentInput = Omit<SupportDiagnosticIncident, "sequence" | "at" | "layer">;

export class RendererDiagnosticEvidence {
  private readonly actions = new BoundedDiagnosticEvidence<SupportDiagnosticAction>(MAX_RENDERER_ACTIONS);
  private readonly incidents = new BoundedDiagnosticEvidence<SupportDiagnosticIncident>(MAX_RENDERER_INCIDENTS);
  private nextSequence = 1;

  constructor(private readonly now: () => number = Date.now) {}

  recordAction(action: SupportDiagnosticActionName, stage: SupportDiagnosticActionStage): void {
    this.actions.record({ sequence: this.takeSequence(), at: boundedInteger(this.now()), action, stage });
  }

  recordIncident(incident: RendererIncidentInput): void {
    this.incidents.record({
      sequence: this.takeSequence(),
      at: boundedInteger(this.now()),
      layer: "renderer",
      ...incident
    });
  }

  recordAutomaticReplacementSuppressed(error: unknown, connectionGeneration: number): void {
    this.recordIncident({
      phase: "port-close",
      outcome: "suppressed",
      errorClass: classifyRendererDiagnosticError(error),
      reason: "automatic-replacement-suppressed",
      connectionGeneration
    });
  }

  recordRequestStarted(command: AgentCommandType, connectionGeneration: number, hostEpoch?: number): void {
    this.recordIncident({
      phase: "request",
      outcome: "started",
      command,
      connectionGeneration,
      ...(hostEpoch === undefined ? {} : { hostEpoch })
    });
  }

  recordRequestSettled(options: {
    command: AgentCommandType;
    connectionGeneration: number;
    hostEpoch?: number;
    startedAt: number;
    error?: unknown;
  }): void {
    const failed = "error" in options;
    this.recordIncident({
      phase: "request",
      outcome: failed ? "failed" : "completed",
      command: options.command,
      ...(failed ? {
        errorClass: classifyRendererDiagnosticError(options.error),
        reason: "request-failed" as const
      } : {}),
      connectionGeneration: options.connectionGeneration,
      ...(options.hostEpoch === undefined ? {} : { hostEpoch: options.hostEpoch }),
      durationMs: boundedInteger(this.now() - options.startedAt)
    });
  }

  recordProjectionStarted(connectionGeneration: number, hostEpoch?: number): void {
    this.recordIncident({
      phase: "projection-resync",
      outcome: "started",
      command: "projection.resync",
      connectionGeneration,
      ...(hostEpoch === undefined ? {} : { hostEpoch })
    });
  }

  recordProjectionSettled(options: {
    connectionGeneration: number;
    hostEpoch?: number;
    startedAt: number;
    committed?: boolean;
    error?: unknown;
  }): void {
    const failed = "error" in options || options.committed === false;
    this.recordIncident({
      phase: "projection-resync",
      outcome: failed ? "failed" : "completed",
      command: "projection.resync",
      ...(failed ? { reason: "projection-resync-failed" as const } : {}),
      ...("error" in options ? { errorClass: classifyRendererDiagnosticError(options.error) } : {}),
      connectionGeneration: options.connectionGeneration,
      ...(options.hostEpoch === undefined ? {} : { hostEpoch: options.hostEpoch }),
      durationMs: boundedInteger(this.now() - options.startedAt)
    });
  }

  recordPortAttached(connectionGeneration: number, hostEpoch: number): void {
    this.recordIncident({
      phase: "port-attach",
      outcome: "completed",
      reason: "port-attached",
      connectionGeneration,
      hostEpoch
    });
  }

  recordHandshakeCompleted(connectionGeneration: number, hostEpoch: number): void {
    this.recordIncident({ phase: "handshake", outcome: "completed", connectionGeneration, hostEpoch });
  }

  recordPortClosed(options: {
    connectionGeneration: number;
    durationMs: number;
    error: unknown;
    reason: RendererConnectionTeardownReason;
  }): void {
    this.recordIncident({
      phase: "port-close",
      outcome: "closed",
      errorClass: classifyRendererDiagnosticError(options.error),
      reason: options.reason,
      connectionGeneration: options.connectionGeneration,
      durationMs: boundedInteger(options.durationMs)
    });
  }

  snapshot(): {
    actions: SupportDiagnosticAction[];
    actionsDroppedCount: number;
    incidents: SupportDiagnosticIncident[];
    incidentsDroppedCount: number;
  } {
    const actions = this.actions.snapshot((action) => ({ ...action }));
    const incidents = this.incidents.snapshot((incident) => ({ ...incident }));
    return {
      actions: actions.entries,
      actionsDroppedCount: actions.droppedCount,
      incidents: incidents.entries,
      incidentsDroppedCount: incidents.droppedCount
    };
  }

  private takeSequence(): number {
    const sequence = this.nextSequence;
    if (this.nextSequence < Number.MAX_SAFE_INTEGER) this.nextSequence += 1;
    return sequence;
  }
}

function classifyRendererDiagnosticError(error: unknown): SupportDiagnosticErrorClass {
  if (error instanceof ProtocolRequestError) return "ProtocolRequestError";
  const name = error instanceof Error ? error.name : "UnknownError";
  switch (name) {
    case "AbortError":
    case "DataCloneError":
    case "RangeError":
    case "TimeoutError":
    case "TypeError":
    case "ValidationError":
      return name;
    default:
      return "UnknownError";
  }
}

export function diagnosticActionForCommand(type: AgentCommandType): SupportDiagnosticActionName | undefined {
  switch (type) {
    case "runtime.initialize":
    case "session.open":
      return "session.open";
    case "session.create":
    case "session.forkFromTask":
      return "task.create";
    case "session.import":
      return "session.import";
    case "workspace.open":
    case "workspace.register":
      return "workspace.open";
    case "prompt.submit":
      return "prompt.submit";
    case "model.select":
      return "model.select";
    default:
      return undefined;
  }
}

function boundedInteger(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value)));
}
