import { BoundedDiagnosticEvidence } from "@pi67/domain";
import {
  type SupportDiagnosticErrorClass,
  type SupportDiagnosticIncident,
  type SupportDiagnosticIncidentOutcome,
  type SupportDiagnosticIncidentPhase,
  type SupportDiagnosticIncidentReason
} from "@pi67/protocol";

const MAX_HOST_INCIDENTS = 32;

export type HostDiagnosticIncidentInput = Omit<
  SupportDiagnosticIncident,
  "sequence" | "at" | "layer"
>;

export class HostDiagnosticEvidence {
  private readonly incidents = new BoundedDiagnosticEvidence<SupportDiagnosticIncident>(MAX_HOST_INCIDENTS);
  private nextIncidentSequence = 1;
  private nextConnectionSequence = 1;

  constructor(private readonly now: () => number = Date.now) {}

  attach(hostEpoch: number): number {
    const connectionSequence = this.nextConnectionSequence;
    this.nextConnectionSequence = increment(this.nextConnectionSequence);
    this.record({
      phase: "port-attach",
      outcome: "completed",
      reason: "port-attached",
      connectionSequence,
      hostEpoch
    });
    return connectionSequence;
  }

  record(incident: HostDiagnosticIncidentInput): void {
    this.incidents.record({
      sequence: this.nextIncidentSequence,
      at: boundedInteger(this.now()),
      layer: "agent-host",
      ...incident
    });
    this.nextIncidentSequence = increment(this.nextIncidentSequence);
  }

  snapshot(): { incidents: SupportDiagnosticIncident[]; incidentsDroppedCount: number } {
    const snapshot = this.incidents.snapshot((incident) => ({ ...incident }));
    return { incidents: snapshot.entries, incidentsDroppedCount: snapshot.droppedCount };
  }
}

export function classifyDiagnosticError(error: unknown): SupportDiagnosticErrorClass {
  const name = error instanceof Error ? error.name : "UnknownError";
  switch (name) {
    case "AbortError":
    case "DataCloneError":
    case "ProtocolRequestError":
    case "RangeError":
    case "TimeoutError":
    case "TypeError":
    case "ValidationError":
      return name;
    default:
      return "UnknownError";
  }
}

export function hostDiagnosticReason(reason: string): SupportDiagnosticIncidentReason {
  switch (reason) {
    case "connection-replaced":
    case "connection-closed":
    case "peer-closed":
    case "message-error":
    case "response-post-failed":
    case "event-post-failed":
    case "event-envelope-too-large":
    case "request-envelope-too-large":
    case "invalid-hello":
    case "wrong-app-instance":
    case "handshake-failed":
      return reason;
    default:
      return "connection-closed";
  }
}

export function hostIncident(
  phase: SupportDiagnosticIncidentPhase,
  outcome: SupportDiagnosticIncidentOutcome,
  input: Omit<HostDiagnosticIncidentInput, "phase" | "outcome"> = {}
): HostDiagnosticIncidentInput {
  return { phase, outcome, ...input };
}

export function diagnosticEnvelopeType(envelope: unknown): string {
  if (typeof envelope !== "object" || envelope === null) return "unknown";
  const type = (envelope as { type?: unknown }).type;
  return typeof type === "string" && type.length <= 80 ? type : "unknown";
}

export function diagnosticBinaryByteEvidence(envelope: unknown): { binaryBytes?: number } {
  if (diagnosticEnvelopeType(envelope) !== "asset.read" || typeof envelope !== "object" || envelope === null) {
    return {};
  }
  if ((envelope as { ok?: unknown }).ok !== true) return {};
  const result = (envelope as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return {};
  const data = (result as { data?: unknown }).data;
  return data instanceof ArrayBuffer ? { binaryBytes: data.byteLength } : {};
}

function increment(value: number): number {
  return value === Number.MAX_SAFE_INTEGER ? value : value + 1;
}

function boundedInteger(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value)));
}
