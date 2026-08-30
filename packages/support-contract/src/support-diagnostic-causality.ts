export const SUPPORT_DIAGNOSTICS_MAX_RECENT_ACTIONS = 16;
export const SUPPORT_DIAGNOSTICS_MAX_RECENT_INCIDENTS = 32;

const COMMAND_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const ACTION_KEYS = new Set(["sequence", "at", "action", "stage"]);
const RENDERER_CAUSALITY_KEYS = new Set([
  "actions",
  "actionsDroppedCount",
  "incidents",
  "incidentsDroppedCount"
]);
const INCIDENT_KEYS = new Set([
  "sequence",
  "at",
  "layer",
  "phase",
  "outcome",
  "command",
  "errorClass",
  "reason",
  "connectionSequence",
  "connectionGeneration",
  "hostEpoch",
  "durationMs",
  "binaryBytes"
]);

export type SupportDiagnosticActionName =
  | "application.start"
  | "application.resume"
  | "workspace.open"
  | "task.create"
  | "task.select"
  | "task.resume"
  | "session.open"
  | "session.import"
  | "prompt.submit"
  | "model.select"
  | "connection.recover"
  | "diagnostics.upload"
  | "update.check";

export type SupportDiagnosticActionStage = "started" | "completed" | "failed";

export interface SupportDiagnosticAction {
  sequence: number;
  at: number;
  action: SupportDiagnosticActionName;
  stage: SupportDiagnosticActionStage;
}

export type SupportDiagnosticIncidentLayer = "renderer" | "agent-host";
export type SupportDiagnosticIncidentPhase =
  | "port-attach"
  | "handshake"
  | "request"
  | "response-post"
  | "event-post"
  | "port-close"
  | "projection-resync"
  | "runtime-initialize"
  | "host-exit";
export type SupportDiagnosticIncidentOutcome = "started" | "completed" | "failed" | "closed" | "suppressed";
export type SupportDiagnosticErrorClass =
  | "AbortError"
  | "DataCloneError"
  | "ProtocolRequestError"
  | "RangeError"
  | "TimeoutError"
  | "TypeError"
  | "ValidationError"
  | "UnknownError";
export type SupportDiagnosticIncidentReason =
  | "port-attached"
  | "port-closed"
  | "message-error"
  | "message-decode-failed"
  | "connection-replaced"
  | "connection-closed"
  | "peer-closed"
  | "handshake-timeout"
  | "handshake-send-failed"
  | "handshake-rejected"
  | "handshake-identity-mismatch"
  | "handshake-failed"
  | "invalid-hello"
  | "wrong-app-instance"
  | "protocol-violation"
  | "request-send-failed"
  | "request-cancellation-send-failed"
  | "request-failed"
  | "response-post-failed"
  | "event-post-failed"
  | "event-envelope-too-large"
  | "request-envelope-too-large"
  | "stale-response"
  | "automatic-replacement-suppressed"
  | "projection-resync-failed"
  | "disposed";

export interface SupportDiagnosticIncident {
  sequence: number;
  at: number;
  layer: SupportDiagnosticIncidentLayer;
  phase: SupportDiagnosticIncidentPhase;
  outcome: SupportDiagnosticIncidentOutcome;
  command?: string;
  errorClass?: SupportDiagnosticErrorClass;
  reason?: SupportDiagnosticIncidentReason;
  connectionSequence?: number;
  connectionGeneration?: number;
  hostEpoch?: number;
  durationMs?: number;
  binaryBytes?: number;
}

export interface SupportDiagnosticsCausality {
  renderer: {
    actions: SupportDiagnosticAction[];
    actionsDroppedCount: number;
    incidents: SupportDiagnosticIncident[];
    incidentsDroppedCount: number;
  };
  agentHost?: {
    incidents: SupportDiagnosticIncident[];
    incidentsDroppedCount: number;
  };
}

export function isSupportDiagnosticsCausality(value: unknown): value is SupportDiagnosticsCausality {
  if (!isRecord(value) || !hasOnlyKeys(value, new Set(["renderer", "agentHost"]))) return false;
  if (!isRecord(value.renderer) || !hasOnlyKeys(value.renderer, RENDERER_CAUSALITY_KEYS)) return false;
  if (!isActions(value.renderer.actions) || !isBoundedCount(value.renderer.actionsDroppedCount)) return false;
  if (!isIncidents(value.renderer.incidents, "renderer") || !isBoundedCount(value.renderer.incidentsDroppedCount)) {
    return false;
  }
  if (value.agentHost === undefined) return true;
  return isRecord(value.agentHost)
    && hasOnlyKeys(value.agentHost, new Set(["incidents", "incidentsDroppedCount"]))
    && isIncidents(value.agentHost.incidents, "agent-host")
    && isBoundedCount(value.agentHost.incidentsDroppedCount);
}

function isActions(value: unknown): value is SupportDiagnosticAction[] {
  return Array.isArray(value)
    && value.length <= SUPPORT_DIAGNOSTICS_MAX_RECENT_ACTIONS
    && value.every((entry) => isRecord(entry)
      && hasOnlyKeys(entry, ACTION_KEYS)
      && isBoundedCount(entry.sequence)
      && isTimestamp(entry.at)
      && isActionName(entry.action)
      && (entry.stage === "started" || entry.stage === "completed" || entry.stage === "failed"));
}

function isIncidents(value: unknown, layer: SupportDiagnosticIncidentLayer): value is SupportDiagnosticIncident[] {
  return Array.isArray(value)
    && value.length <= SUPPORT_DIAGNOSTICS_MAX_RECENT_INCIDENTS
    && value.every((entry) => isRecord(entry)
      && hasOnlyKeys(entry, INCIDENT_KEYS)
      && isBoundedCount(entry.sequence)
      && isTimestamp(entry.at)
      && entry.layer === layer
      && isIncidentPhase(entry.phase)
      && isIncidentOutcome(entry.outcome)
      && (entry.command === undefined || (
        typeof entry.command === "string"
        && entry.command.length <= 80
        && COMMAND_PATTERN.test(entry.command)
      ))
      && (entry.errorClass === undefined || isIncidentErrorClass(entry.errorClass))
      && (entry.reason === undefined || isIncidentReason(entry.reason))
      && optionalBoundedCount(entry.connectionSequence)
      && optionalBoundedCount(entry.connectionGeneration)
      && optionalBoundedCount(entry.hostEpoch)
      && optionalBoundedCount(entry.durationMs)
      && optionalBoundedCount(entry.binaryBytes));
}

function isActionName(value: unknown): value is SupportDiagnosticActionName {
  return typeof value === "string" && new Set<string>([
    "application.start",
    "application.resume",
    "workspace.open",
    "task.create",
    "task.select",
    "task.resume",
    "session.open",
    "session.import",
    "prompt.submit",
    "model.select",
    "connection.recover",
    "diagnostics.upload",
    "update.check"
  ]).has(value);
}

function isIncidentPhase(value: unknown): value is SupportDiagnosticIncidentPhase {
  return typeof value === "string" && new Set<string>([
    "port-attach",
    "handshake",
    "request",
    "response-post",
    "event-post",
    "port-close",
    "projection-resync",
    "runtime-initialize",
    "host-exit"
  ]).has(value);
}

function isIncidentOutcome(value: unknown): value is SupportDiagnosticIncidentOutcome {
  return value === "started" || value === "completed" || value === "failed"
    || value === "closed" || value === "suppressed";
}

function isIncidentErrorClass(value: unknown): value is SupportDiagnosticErrorClass {
  return typeof value === "string" && new Set<string>([
    "AbortError",
    "DataCloneError",
    "ProtocolRequestError",
    "RangeError",
    "TimeoutError",
    "TypeError",
    "ValidationError",
    "UnknownError"
  ]).has(value);
}

function isIncidentReason(value: unknown): value is SupportDiagnosticIncidentReason {
  return typeof value === "string" && new Set<string>([
    "port-attached",
    "port-closed",
    "message-error",
    "message-decode-failed",
    "connection-replaced",
    "connection-closed",
    "peer-closed",
    "handshake-timeout",
    "handshake-send-failed",
    "handshake-rejected",
    "handshake-identity-mismatch",
    "handshake-failed",
    "invalid-hello",
    "wrong-app-instance",
    "protocol-violation",
    "request-send-failed",
    "request-cancellation-send-failed",
    "request-failed",
    "response-post-failed",
    "event-post-failed",
    "event-envelope-too-large",
    "request-envelope-too-large",
    "stale-response",
    "automatic-replacement-suppressed",
    "projection-resync-failed",
    "disposed"
  ]).has(value);
}

function optionalBoundedCount(value: unknown): boolean {
  return value === undefined || isBoundedCount(value);
}

function isBoundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
