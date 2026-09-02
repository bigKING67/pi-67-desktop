import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PrivacyMode } from "./config.js";

export type ContextDiagnosticKind =
  | "context.ownerLocked"
  | "context.healthChanged"
  | "context.recallStarted"
  | "context.recallCompleted"
  | "context.captureCompleted"
  | "context.memoryDisabled";

export interface ContextDiagnosticEvent {
  schema: "pi67.context-diagnostic.v1";
  kind: ContextDiagnosticKind;
  at: string;
  owner: "pi67-openviking";
  privacyMode: PrivacyMode;
  state: string;
  durationMs?: number;
  count?: number;
  reason?: string;
}

export function emitContextDiagnostic(
  event: Omit<ContextDiagnosticEvent, "schema" | "at" | "owner">,
): void {
  const record: ContextDiagnosticEvent = {
    schema: "pi67.context-diagnostic.v1",
    at: new Date().toISOString(),
    owner: "pi67-openviking",
    ...event,
  };
  try {
    const sender = (process as NodeJS.Process & { send?: (value: unknown) => void }).send;
    sender?.({ type: "pi67.context.event", event: record });
  } catch {
    // Diagnostics are observational and must never block Pi.
  }
  const file = process.env.PI67_CONTEXT_EVENT_LOG;
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch {
    // Local diagnostic persistence is best effort and contains no prompt body.
  }
}
