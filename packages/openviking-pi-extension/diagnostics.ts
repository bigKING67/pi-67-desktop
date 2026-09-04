import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PrivacyMode } from "./config.js";

const MAX_DIAGNOSTIC_BYTES = 256 * 1_024;
const RETAIN_DIAGNOSTIC_BYTES = 128 * 1_024;

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
  route?: "prompt-context" | "startup-context" | "official-find" | "scoped-find" | "find-fast" | "session-context" | "find-fallback" | "cache";
  candidateCount?: number;
  selectedCount?: number;
  tokenBudget?: number;
  usedTokens?: number;
  detailMode?: "abstract-first" | "bounded-content";
  queryHash?: string;
  sessionIdHash?: string;
  scopeHash?: string;
  items?: Array<{
    id: string;
    source: "private-memory" | "private-experience" | "resource";
    score: number;
  }>;
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
  const agentDir = process.env.PI_CODING_AGENT_DIR || process.env.PI_AGENT_DIR;
  const file = process.env.PI67_CONTEXT_EVENT_LOG
    || (agentDir ? join(agentDir, "runtime", "context-recall-observations.ndjson") : undefined);
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    compactDiagnosticFile(file);
  } catch {
    // Local diagnostic persistence is best effort and contains no prompt body.
  }
}

export function hashDiagnosticValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compactDiagnosticFile(file: string): void {
  if (statSync(file).size <= MAX_DIAGNOSTIC_BYTES) return;
  const raw = readFileSync(file, "utf8");
  let tail = raw.slice(-RETAIN_DIAGNOSTIC_BYTES);
  const boundary = tail.indexOf("\n");
  if (boundary >= 0) tail = tail.slice(boundary + 1);
  writeFileSync(file, tail, { encoding: "utf8", mode: 0o600 });
}
