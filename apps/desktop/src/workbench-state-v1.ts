import { isAbsolute } from "node:path";
import {
  MAX_WORKSPACE_ID_LENGTH,
  MAX_WORKSPACE_PATH_LENGTH,
  parseWorkspaceDescriptor,
  workspaceDescriptorsReferToSameDirectory,
  type WorkspaceDescriptor
} from "./workspace-identity.js";
import {
  MAX_RUNTIME_RECOVERY_RECORDS,
  MAX_WORKSPACES,
  isTaskLifecycle,
  parseExactWorkbenchIdOrder,
  type ConversationKey,
  type RuntimeRecoveryRecordV2,
  type SettingsSection,
  type TaskLifecycle,
  type WorkbenchSettingsState,
  type WorkbenchStateV2,
  type WorkbenchSurface
} from "./workbench-state-contract.js";
import { parseWorkbenchStateV2 } from "./workbench-state-v2.js";

const LEGACY_STATE_VERSION = 1;
const MAX_PERSISTED_TASKS = 24;
const MAX_TASK_ID_LENGTH = 200;
const MAX_SESSION_ID_LENGTH = 1_024;

interface LegacyTaskState {
  taskId: string;
  workspaceId: string;
  sessionId: string;
  sessionPath?: string;
  visibility: "tab" | "detached";
  lastKnownLifecycle: TaskLifecycle;
}

interface LegacySettingsState {
  open: boolean;
  section: LegacySettingsSection;
  scope: "global" | "project";
  workspaceId?: string;
}

type LegacySettingsSection =
  | "general"
  | "providers"
  | "extensions"
  | "resources"
  | "runtime"
  | "updates"
  | "about";

type LegacySurface =
  | { kind: "task"; taskId: string }
  | { kind: "settings" }
  | { kind: "workspace"; workspaceId: string };

interface LegacyStateV1 {
  workspaces: WorkspaceDescriptor[];
  workspaceOrder: string[];
  currentWorkspaceId?: string;
  tasks: LegacyTaskState[];
  taskOrder: string[];
  selectedSurface?: LegacySurface;
  settings: LegacySettingsState;
  cleanExit: boolean;
}

export function parseAndMigrateWorkbenchStateV1(value: unknown): WorkbenchStateV2 | undefined {
  const legacy = parseLegacyState(value);
  if (!legacy) return undefined;

  const orderedTasks = legacy.taskOrder.map((taskId) => legacy.tasks.find((task) => task.taskId === taskId)!);
  const recoverable = orderedTasks.filter((task) => shouldRecoverLegacyTask(task.lastKnownLifecycle));
  const legacySelectedSurface = legacy.selectedSurface;
  const selectedTask = legacySelectedSurface?.kind === "task"
    ? legacy.tasks.find((task) => task.taskId === legacySelectedSurface.taskId)
    : undefined;
  const recoveryTasks = selectedTask && shouldRecoverLegacyTask(selectedTask.lastKnownLifecycle)
    ? [selectedTask, ...recoverable.filter((task) => task.taskId !== selectedTask.taskId)]
    : recoverable;
  const runtimeRecovery = recoveryTasks
    .slice(0, MAX_RUNTIME_RECOVERY_RECORDS)
    .map(migrateRuntimeRecoveryRecord);

  const selectedSurface = migrateSelectedSurface(legacy, runtimeRecovery);
  const selectedWorkspaceId = selectedSurface?.kind === "conversation"
    ? selectedSurface.conversation.workspaceId
    : selectedSurface?.kind === "workspace"
      ? selectedSurface.workspaceId
      : undefined;
  const currentWorkspaceId = selectedWorkspaceId ?? legacy.currentWorkspaceId;
  const settings = migrateSettings(legacy.settings);
  const migrated: WorkbenchStateV2 = {
    version: 2,
    workspaces: legacy.workspaces,
    workspaceOrder: legacy.workspaceOrder,
    expandedWorkspaceIds: currentWorkspaceId ? [currentWorkspaceId] : [],
    ...(currentWorkspaceId ? { currentWorkspaceId } : {}),
    ...(selectedSurface ? { selectedSurface } : {}),
    runtimeRecovery,
    settings,
    cleanExit: legacy.cleanExit
  };
  return parseWorkbenchStateV2(migrated);
}

function parseLegacyState(value: unknown): LegacyStateV1 | undefined {
  if (!isRecordWithAllowedKeys(
    value,
    [
      "version",
      "workspaces",
      "workspaceOrder",
      "currentWorkspaceId",
      "tasks",
      "taskOrder",
      "selectedSurface",
      "settings",
      "cleanExit"
    ],
    ["version", "workspaces", "workspaceOrder", "tasks", "taskOrder", "settings", "cleanExit"]
  )) return undefined;
  if (value.version !== LEGACY_STATE_VERSION || typeof value.cleanExit !== "boolean") return undefined;
  const workspaces = parseWorkspaces(value.workspaces);
  if (!workspaces) return undefined;
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const workspaceOrder = parseExactWorkbenchIdOrder(value.workspaceOrder, workspaceIds, MAX_WORKSPACES);
  if (!workspaceOrder) return undefined;
  if (value.currentWorkspaceId !== undefined && !isKnownWorkspaceId(value.currentWorkspaceId, workspaceIds)) {
    return undefined;
  }
  const tasks = parseLegacyTasks(value.tasks, workspaceIds);
  if (!tasks) return undefined;
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const taskOrder = parseExactWorkbenchIdOrder(value.taskOrder, taskIds, MAX_PERSISTED_TASKS);
  const settings = parseLegacySettings(value.settings, workspaceIds);
  if (!taskOrder || !settings) return undefined;
  const selectedSurface = value.selectedSurface === undefined
    ? undefined
    : parseLegacySurface(value.selectedSurface, workspaceIds, taskIds);
  if (value.selectedSurface !== undefined && !selectedSurface) return undefined;

  return {
    workspaces,
    workspaceOrder,
    ...(typeof value.currentWorkspaceId === "string" ? { currentWorkspaceId: value.currentWorkspaceId } : {}),
    tasks,
    taskOrder,
    ...(selectedSurface ? { selectedSurface } : {}),
    settings,
    cleanExit: value.cleanExit
  };
}

function parseWorkspaces(value: unknown): WorkspaceDescriptor[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_WORKSPACES) return undefined;
  const workspaces: WorkspaceDescriptor[] = [];
  for (const candidate of value) {
    const workspace = parseWorkspaceDescriptor(candidate);
    if (!workspace || workspaces.some((current) => (
      current.id === workspace.id || workspaceDescriptorsReferToSameDirectory(current, workspace)
    ))) return undefined;
    workspaces.push(workspace);
  }
  return workspaces;
}

function parseLegacyTasks(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): LegacyTaskState[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PERSISTED_TASKS) return undefined;
  const tasks: LegacyTaskState[] = [];
  const taskIds = new Set<string>();
  const sessionPaths = new Set<string>();
  for (const candidate of value) {
    if (!isRecordWithAllowedKeys(
      candidate,
      ["taskId", "workspaceId", "sessionId", "sessionPath", "visibility", "lastKnownLifecycle"],
      ["taskId", "workspaceId", "sessionId", "visibility", "lastKnownLifecycle"]
    )) return undefined;
    if (
      !isBoundedId(candidate.taskId, MAX_TASK_ID_LENGTH)
      || !isKnownWorkspaceId(candidate.workspaceId, workspaceIds)
      || !isBoundedId(candidate.sessionId, MAX_SESSION_ID_LENGTH)
      || (candidate.visibility !== "tab" && candidate.visibility !== "detached")
      || !isTaskLifecycle(candidate.lastKnownLifecycle)
      || (candidate.sessionPath !== undefined && !isAbsoluteBoundedPath(candidate.sessionPath))
    ) return undefined;
    const normalizedSessionPath = typeof candidate.sessionPath === "string"
      ? normalizePath(candidate.sessionPath)
      : undefined;
    if (taskIds.has(candidate.taskId) || (normalizedSessionPath && sessionPaths.has(normalizedSessionPath))) {
      return undefined;
    }
    taskIds.add(candidate.taskId);
    if (normalizedSessionPath) sessionPaths.add(normalizedSessionPath);
    tasks.push({
      taskId: candidate.taskId,
      workspaceId: candidate.workspaceId,
      sessionId: candidate.sessionId,
      ...(typeof candidate.sessionPath === "string" ? { sessionPath: candidate.sessionPath } : {}),
      visibility: candidate.visibility,
      lastKnownLifecycle: candidate.lastKnownLifecycle
    });
  }
  return tasks;
}

function parseLegacySettings(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): LegacySettingsState | undefined {
  if (!isRecordWithAllowedKeys(value, ["open", "section", "scope", "workspaceId"], ["open", "section", "scope"])) {
    return undefined;
  }
  if (typeof value.open !== "boolean" || !isLegacySettingsSection(value.section)) return undefined;
  if (value.scope === "global") {
    if (value.workspaceId !== undefined) return undefined;
  } else if (value.scope === "project") {
    if (!isKnownWorkspaceId(value.workspaceId, workspaceIds)) return undefined;
  } else {
    return undefined;
  }
  return {
    open: value.open,
    section: value.section,
    scope: value.scope,
    ...(typeof value.workspaceId === "string" ? { workspaceId: value.workspaceId } : {})
  };
}

function parseLegacySurface(
  value: unknown,
  workspaceIds: ReadonlySet<string>,
  taskIds: ReadonlySet<string>
): LegacySurface | undefined {
  if (!isRecord(value)) return undefined;
  if (hasExactKeys(value, ["kind"]) && value.kind === "settings") return { kind: "settings" };
  if (hasExactKeys(value, ["kind", "workspaceId"]) && value.kind === "workspace"
    && isKnownWorkspaceId(value.workspaceId, workspaceIds)) {
    return { kind: "workspace", workspaceId: value.workspaceId };
  }
  if (hasExactKeys(value, ["kind", "taskId"]) && value.kind === "task"
    && isBoundedId(value.taskId, MAX_TASK_ID_LENGTH) && taskIds.has(value.taskId)) {
    return { kind: "task", taskId: value.taskId };
  }
  return undefined;
}

function migrateRuntimeRecoveryRecord(task: LegacyTaskState): RuntimeRecoveryRecordV2 {
  return {
    taskId: task.taskId,
    conversation: conversationForLegacyTask(task),
    sessionId: task.sessionId,
    taskGeneration: 1,
    lastKnownLifecycle: task.lastKnownLifecycle
  };
}

function migrateSelectedSurface(
  legacy: LegacyStateV1,
  runtimeRecovery: readonly RuntimeRecoveryRecordV2[]
): WorkbenchSurface | undefined {
  const selected = legacy.selectedSurface;
  if (selected?.kind === "settings" && legacy.settings.open) return { kind: "settings" };
  if (selected?.kind === "workspace") return selected;
  if (selected?.kind === "task") {
    const task = legacy.tasks.find((candidate) => candidate.taskId === selected.taskId);
    if (task?.sessionPath) return { kind: "conversation", conversation: conversationForLegacyTask(task) };
    const recovery = runtimeRecovery.find((candidate) => candidate.taskId === selected.taskId);
    if (recovery) return { kind: "conversation", conversation: recovery.conversation };
  }
  return legacy.currentWorkspaceId
    ? { kind: "workspace", workspaceId: legacy.currentWorkspaceId }
    : undefined;
}

function conversationForLegacyTask(task: LegacyTaskState): ConversationKey {
  return task.sessionPath
    ? { kind: "session", workspaceId: task.workspaceId, sessionPath: task.sessionPath }
    : { kind: "provisional", workspaceId: task.workspaceId, draftId: task.taskId };
}

function migrateSettings(settings: LegacySettingsState): WorkbenchSettingsState {
  const section: SettingsSection = settings.section === "resources" ? "skills" : settings.section;
  const globalOnly = section === "general" || section === "updates" || section === "about";
  if (globalOnly || settings.scope === "global") return { section, scope: "global" };
  return settings.workspaceId
    ? { section, scope: "project", workspaceId: settings.workspaceId }
    : { section, scope: "global" };
}

function shouldRecoverLegacyTask(lifecycle: TaskLifecycle): boolean {
  return lifecycle === "initializing"
    || lifecycle === "accepted"
    || lifecycle === "running"
    || lifecycle === "waiting-approval"
    || lifecycle === "waiting-extension-input"
    || lifecycle === "failed"
    || lifecycle === "lost";
}

function isLegacySettingsSection(value: unknown): value is LegacySettingsSection {
  return typeof value === "string" && [
    "general",
    "providers",
    "extensions",
    "resources",
    "runtime",
    "updates",
    "about"
  ].includes(value);
}

function isKnownWorkspaceId(value: unknown, workspaceIds: ReadonlySet<string>): value is string {
  return isBoundedId(value, MAX_WORKSPACE_ID_LENGTH) && workspaceIds.has(value);
}

function isAbsoluteBoundedPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_WORKSPACE_PATH_LENGTH
    && !value.includes("\0") && isAbsolute(value);
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isBoundedId(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && !value.includes("\0") && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordWithAllowedKeys(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.hasOwn(value, key));
}
