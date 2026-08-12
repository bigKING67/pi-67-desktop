import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import {
  SessionManager,
  type AgentSession
} from "@earendil-works/pi-coding-agent";
import {
  MAX_NATIVE_SUBAGENT_ERROR_CHARS,
  MAX_NATIVE_SUBAGENT_NESTING_DEPTH,
  MAX_NATIVE_SUBAGENT_RESULT_CHARS,
  RuntimeError,
  type NativeSubagentChangeReason,
  type NativeSubagentLineage,
  type NativeSubagentMode,
  type NativeSubagentSpawnRequest,
  type NativeSubagentUsage,
  type NativeSubagentView
} from "@pi67/domain";
import type {
  NativeSubagentAdmission,
  NativeSubagentAdmissionLease
} from "./native-subagent-admission.js";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

export interface NativeSubagentSessionHandle {
  session: AgentSession;
  dispose(): Promise<void>;
}

export interface NativeSubagentSessionFactoryInput {
  sessionManager: SessionManager;
  lineage: NativeSubagentLineage;
  parentModel: Model<any> | undefined;
  requestedModel?: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
}

export interface NativeSubagentCoordinatorOptions {
  admission: NativeSubagentAdmission;
  parentKey: string;
  getAgentDir: () => string;
  createSession: (input: NativeSubagentSessionFactoryInput) => Promise<NativeSubagentSessionHandle>;
  emit: (item: NativeSubagentView, reason: NativeSubagentChangeReason) => void;
  now?: () => number;
  createId?: () => string;
}

export interface ChildRecord {
  view: NativeSubagentView;
  sessionManager: SessionManager | undefined;
  active: ChildActivation | undefined;
  lease: NativeSubagentAdmissionLease | undefined;
}

export interface ChildActivation {
  activationId: string;
  handle: NativeSubagentSessionHandle;
  unsubscribe: () => void;
  cleanup: Promise<void> | undefined;
}

export interface BoundParent {
  session: AgentSession;
  directory: string;
}

export async function createNativeSubagentRecord(input: {
  request: NativeSubagentSpawnRequest;
  parent: BoundParent;
  parentChildId?: string;
  depth: number;
  runId: string;
  childId: string;
  activationId: string;
  lease: NativeSubagentAdmissionLease;
  timestamp: number;
}): Promise<{
  record: ChildRecord;
  sessionInput: NativeSubagentSessionFactoryInput;
  prompt: string;
}> {
  const childDirectory = join(input.parent.directory, safePathSegment(input.childId));
  await mkdir(childDirectory, { recursive: true, mode: 0o700 });
  const sessionManager = createChildSessionManager(
    input.request.context ?? "fresh",
    input.parent.session,
    childDirectory,
    input.childId
  );
  const sessionPath = sessionManager.getSessionFile();
  const inheritedModel = input.request.model ?? (input.parent.session.model
    ? { provider: input.parent.session.model.provider, id: input.parent.session.model.id }
    : undefined);
  const lineage: NativeSubagentLineage = {
    runId: input.runId,
    childId: input.childId,
    activationId: input.activationId,
    ...(input.parentChildId === undefined ? {} : { parentChildId: input.parentChildId }),
    depth: input.depth,
    role: input.request.role ?? "general"
  };
  const view: NativeSubagentView = {
    ...lineage,
    state: "pending",
    mode: input.request.mode ?? "foreground",
    context: input.request.context ?? "fresh",
    isolation: "shared",
    ...(inheritedModel === undefined ? {} : { model: inheritedModel }),
    reasoning: input.request.reasoning ?? input.parent.session.thinkingLevel,
    cwd: sessionManager.getCwd(),
    ...(sessionPath === undefined ? {} : { sessionPath }),
    updatedAt: input.timestamp
  };
  return {
    record: { view, sessionManager, active: undefined, lease: input.lease },
    sessionInput: {
      sessionManager,
      lineage,
      parentModel: input.parent.session.model,
      ...(input.request.model === undefined ? {} : { requestedModel: input.request.model }),
      thinkingLevel: (input.request.reasoning ?? input.parent.session.thinkingLevel) as ThinkingLevel
    },
    prompt: rolePrompt(view.role, input.request.task)
  };
}

export function prepareNativeSubagentResume(input: {
  record: ChildRecord;
  parentModel: Model<any> | undefined;
  parentThinkingLevel: ThinkingLevel;
  activationId: string;
  mode?: NativeSubagentMode;
  timestamp: number;
}): NativeSubagentSessionFactoryInput {
  const sessionPath = input.record.view.sessionPath;
  if (!sessionPath) throw new RuntimeError("RUNTIME_NOT_READY", "The child Pi Session file is unavailable.");
  const sessionManager = SessionManager.open(sessionPath, dirname(sessionPath));
  const lineage: NativeSubagentLineage = {
    runId: input.record.view.runId,
    childId: input.record.view.childId,
    activationId: input.activationId,
    ...(input.record.view.parentChildId === undefined ? {} : { parentChildId: input.record.view.parentChildId }),
    depth: input.record.view.depth,
    role: input.record.view.role
  };
  const previousView = { ...input.record.view };
  delete previousView.settledAt;
  delete previousView.result;
  delete previousView.error;
  input.record.view = {
    ...previousView,
    ...lineage,
    state: "pending",
    mode: input.mode ?? input.record.view.mode,
    updatedAt: input.timestamp
  };
  input.record.sessionManager = sessionManager;
  const requestedModel = input.record.view.model;
  return {
    sessionManager,
    lineage,
    parentModel: input.parentModel,
    ...(requestedModel === undefined ? {} : { requestedModel }),
    thinkingLevel: (input.record.view.reasoning ?? input.parentThinkingLevel) as ThinkingLevel
  };
}

function createChildSessionManager(
  context: NativeSubagentSpawnRequest["context"],
  parent: AgentSession,
  childDirectory: string,
  childId: string
): SessionManager {
  const parentSession = parent.sessionFile ?? parent.sessionId;
  if (context === "fork") {
    if (!parent.sessionFile) {
      throw new RuntimeError("RUNTIME_NOT_READY", "The parent Pi JSONL must be persisted before a child can fork it.");
    }
    return SessionManager.forkFrom(parent.sessionFile, parent.sessionManager.getCwd(), childDirectory, {
      id: childId,
      parentSession
    });
  }
  return SessionManager.create(parent.sessionManager.getCwd(), childDirectory, {
    id: childId,
    parentSession
  });
}

function rolePrompt(role: NativeSubagentView["role"], task: string): string {
  const roleInstruction = {
    explorer: "Work read-only. Map the narrow requested scope and return concrete path-and-line evidence.",
    worker: "Implement only the bounded requested scope. Preserve unrelated worktree changes and report exact validation.",
    reviewer: "Review read-only for correctness, security, regressions, and missing tests. Lead with actionable findings.",
    general: "Complete the bounded task directly and report the result with decisive evidence."
  }[role];
  return [
    `You are a Pi-67 native ${role} child agent.`,
    roleInstruction,
    "You are not a top-level Desktop Task. Do not reinterpret Browser Profile, Pi Agent Profile, or Worktree as the same concept.",
    "Return a concise final result to the parent agent when done.",
    "",
    "Task:",
    task
  ].join("\n");
}

export function lastAssistantText(session: AgentSession): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    return message.content
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()
      .slice(0, MAX_NATIVE_SUBAGENT_RESULT_CHARS);
  }
  return "";
}

export function collectUsage(session: AgentSession): NativeSubagentUsage {
  const usage: NativeSubagentUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const message of session.messages) {
    if (message.role !== "assistant") continue;
    usage.input += message.usage.input;
    usage.output += message.usage.output;
    usage.cacheRead += message.usage.cacheRead;
    usage.cacheWrite += message.usage.cacheWrite;
    usage.cost += message.usage.cost.total;
  }
  return usage;
}

export function parsePersistedView(value: unknown): NativeSubagentView | undefined {
  if (!isRecord(value)) return undefined;
  const role = value.role;
  const state = value.state;
  const mode = value.mode;
  const context = value.context;
  const isolation = value.isolation;
  if (
    !isString(value.runId)
    || !isString(value.childId)
    || !isString(value.activationId)
    || !Number.isInteger(value.depth)
    || (value.depth as number) < 1
    || (value.depth as number) > MAX_NATIVE_SUBAGENT_NESTING_DEPTH
    || !["explorer", "worker", "reviewer", "general"].includes(String(role))
    || !["pending", "running", "waiting", "idle", "completed", "failed", "cancelled", "interrupted"].includes(String(state))
    || !["foreground", "background"].includes(String(mode))
    || !["fresh", "fork"].includes(String(context))
    || !["shared", "worktree"].includes(String(isolation))
    || typeof value.updatedAt !== "number"
    || !Number.isFinite(value.updatedAt)
  ) return undefined;
  return value as unknown as NativeSubagentView;
}

export function cloneView(view: NativeSubagentView): NativeSubagentView {
  return {
    ...view,
    ...(view.model === undefined ? {} : { model: { ...view.model } }),
    ...(view.usage === undefined ? {} : { usage: { ...view.usage } })
  };
}

export function errorText(error: unknown): string {
  return sanitizeRuntimeText(error instanceof Error ? error.message : String(error))
    .slice(0, MAX_NATIVE_SUBAGENT_ERROR_CHARS);
}

export function safePathSegment(value: string): string {
  const safe = value.replaceAll(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 128);
  if (!safe) throw new RuntimeError("INVALID_PAYLOAD", "The native subagent identity cannot form a safe path.");
  return safe;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}
