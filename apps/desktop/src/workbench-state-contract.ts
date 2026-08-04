import { isAbsolute } from "node:path";
import { MAX_RUNNING_TASKS } from "@pi67/protocol";
import {
  MAX_WORKSPACE_ID_LENGTH,
  MAX_WORKSPACE_PATH_LENGTH,
  parseWorkspaceDescriptor,
  workspaceDescriptorsReferToSameDirectory,
  type WorkspaceDescriptor
} from "./workspace-identity.js";
import type { TaskLifecycle } from "./workbench-state-lifecycle.js";
import { parseRuntimeRecoveryV3 } from "./workbench-state-recovery-v3.js";

export { isTaskLifecycle, type TaskLifecycle } from "./workbench-state-lifecycle.js";

export const WORKBENCH_STATE_VERSION = 3 as const;
export const WORKBENCH_STATE_DIRECTORY = "workbench";
export const WORKBENCH_STATE_FILENAME = "state-v3.json";
export const LEGACY_WORKBENCH_STATE_V2_FILENAME = "state-v2.json";
export const LEGACY_WORKBENCH_STATE_FILENAME = "state-v1.json";
export const MAX_WORKBENCH_STATE_BYTES = 512 * 1024;
export const MAX_WORKSPACES = 100;
export const MAX_RUNTIME_RECOVERY_RECORDS = MAX_RUNNING_TASKS;

export const MAX_TASK_ID_LENGTH = 200;
export const MAX_SESSION_ID_LENGTH = 1_024;
const MAX_DRAFT_ID_LENGTH = 200;

export type ConversationKey =
  | { kind: "session"; workspaceId: string; sessionPath: string }
  | { kind: "provisional"; workspaceId: string; draftId: string };

export type SessionConversationKey = Extract<ConversationKey, { kind: "session" }>;

export type SettingsSection =
  | "account"
  | "general"
  | "providers"
  | "packages"
  | "extensions"
  | "skills"
  | "prompts"
  | "rules"
  | "mcp"
  | "integrations"
  | "runtime"
  | "network"
  | "updates"
  | "about";

export type WorkbenchSurface =
  | { kind: "conversation"; conversation: ConversationKey }
  | { kind: "settings" }
  | { kind: "workspace"; workspaceId: string };

export interface RuntimeRecoveryRecordV2 {
  taskId: string;
  conversation: ConversationKey;
  sessionId: string;
  taskGeneration: number;
  lastKnownLifecycle: TaskLifecycle;
}

export interface RuntimeRecoveryRecord {
  taskId: string;
  conversation: SessionConversationKey;
  sessionId: string;
  taskGeneration: number;
  sessionGeneration: number;
  hostInstanceId: string;
  hostEpoch: number;
  lastKnownLifecycle: TaskLifecycle;
}

export interface WorkbenchSettingsState {
  section: SettingsSection;
  scope: "global" | "project";
  workspaceId?: string;
}

export interface WorkbenchStateV2 {
  version: 2;
  workspaces: WorkspaceDescriptor[];
  workspaceOrder: string[];
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecordV2[];
  settings: WorkbenchSettingsState;
  cleanExit: boolean;
}

export interface WorkbenchStateV3 {
  version: typeof WORKBENCH_STATE_VERSION;
  workspaces: WorkspaceDescriptor[];
  workspaceOrder: string[];
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  settings: WorkbenchSettingsState;
  cleanExit: boolean;
}

/** Renderer-owned fields. Main retains Workspace registrations, ordering, and clean-exit state. */
export interface WorkbenchLayoutV3 {
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  settings: WorkbenchSettingsState;
}

interface WorkbenchLoadRecovery {
  kind: "corrupt-reset" | "migrated-v1" | "migrated-v2";
  quarantinedFileName?: string;
}

export interface WorkbenchLoadResult {
  state: WorkbenchStateV3;
  recovery?: WorkbenchLoadRecovery;
}

export class UnsupportedWorkbenchStateVersionError extends Error {
  readonly foundVersion: number;

  constructor(foundVersion: number) {
    super(`Workbench state version ${foundVersion} is newer than supported version ${WORKBENCH_STATE_VERSION}.`);
    this.name = "UnsupportedWorkbenchStateVersionError";
    this.foundVersion = foundVersion;
  }
}

export function createEmptyWorkbenchState(): WorkbenchStateV3 {
  return {
    version: WORKBENCH_STATE_VERSION,
    workspaces: [],
    workspaceOrder: [],
    expandedWorkspaceIds: [],
    runtimeRecovery: [],
    settings: { section: "general", scope: "global" },
    cleanExit: false
  };
}

export function beginWorkbenchRun(state: WorkbenchStateV3): WorkbenchStateV3 {
  const recoveredLifecycle = state.cleanExit ? "stopped" : "lost";
  return assertValidWorkbenchState({
    ...state,
    runtimeRecovery: state.runtimeRecovery.map((record) => (
      taskLifecycleWasLive(record.lastKnownLifecycle)
        ? { ...record, lastKnownLifecycle: recoveredLifecycle }
        : record
    )),
    cleanExit: false
  }, "Workbench launch recovery produced invalid state.");
}

export function finishWorkbenchRun(state: WorkbenchStateV3): WorkbenchStateV3 {
  return assertValidWorkbenchState(
    { ...state, runtimeRecovery: [], cleanExit: true },
    "Workbench clean-exit update produced invalid state."
  );
}

export function parseWorkbenchStateV3(value: unknown): WorkbenchStateV3 | undefined {
  if (!isRecordWithAllowedKeys(
    value,
    [
      "version",
      "workspaces",
      "workspaceOrder",
      "expandedWorkspaceIds",
      "currentWorkspaceId",
      "selectedSurface",
      "runtimeRecovery",
      "settings",
      "cleanExit"
    ],
    [
      "version",
      "workspaces",
      "workspaceOrder",
      "expandedWorkspaceIds",
      "runtimeRecovery",
      "settings",
      "cleanExit"
    ]
  )) return undefined;
  if (value.version !== WORKBENCH_STATE_VERSION || typeof value.cleanExit !== "boolean") return undefined;
  const workspaces = parseWorkspaces(value.workspaces);
  if (!workspaces) return undefined;
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const workspaceOrder = parseExactWorkbenchIdOrder(value.workspaceOrder, workspaceIds, MAX_WORKSPACES);
  const expandedWorkspaceIds = parseWorkbenchIdSubset(value.expandedWorkspaceIds, workspaceIds, MAX_WORKSPACES);
  if (!workspaceOrder || !expandedWorkspaceIds) return undefined;
  if (value.currentWorkspaceId !== undefined && !isKnownWorkspaceId(value.currentWorkspaceId, workspaceIds)) {
    return undefined;
  }

  const runtimeRecovery = parseRuntimeRecoveryV3(
    value.runtimeRecovery,
    workspaceIds,
    MAX_RUNTIME_RECOVERY_RECORDS
  );
  const settings = parseWorkbenchSettings(value.settings, workspaceIds);
  if (!runtimeRecovery || !settings) return undefined;
  const selectedSurface = value.selectedSurface === undefined
    ? undefined
    : parseWorkbenchSurfaceV3(value.selectedSurface, workspaceIds);
  if (value.selectedSurface !== undefined && !selectedSurface) return undefined;
  const selectedWorkspaceId = selectedSurfaceWorkspaceId(selectedSurface);
  if (selectedWorkspaceId && value.currentWorkspaceId !== selectedWorkspaceId) return undefined;

  return {
    version: WORKBENCH_STATE_VERSION,
    workspaces,
    workspaceOrder,
    expandedWorkspaceIds,
    ...(typeof value.currentWorkspaceId === "string" ? { currentWorkspaceId: value.currentWorkspaceId } : {}),
    ...(selectedSurface ? { selectedSurface } : {}),
    runtimeRecovery,
    settings,
    cleanExit: value.cleanExit
  };
}

export function assertValidWorkbenchState(state: WorkbenchStateV3, message: string): WorkbenchStateV3 {
  const parsed = parseWorkbenchStateV3(state);
  if (!parsed) throw new Error(message);
  return parsed;
}

export function assertWorkbenchId(value: unknown, label: string): asserts value is string {
  if (!isBoundedId(value, MAX_WORKSPACE_ID_LENGTH)) throw new Error(`${label} is invalid.`);
}

export function parseExactWorkbenchIdOrder(
  value: unknown,
  ids: ReadonlySet<string>,
  maximum: number
): string[] | undefined {
  if (!Array.isArray(value) || value.length !== ids.size || value.length > maximum) return undefined;
  if (!value.every((id): id is string => typeof id === "string" && ids.has(id))) return undefined;
  return new Set(value).size === value.length ? [...value] : undefined;
}

export function parseConversationKey(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): ConversationKey | undefined {
  if (!isRecord(value) || !isKnownWorkspaceId(value.workspaceId, workspaceIds)) return undefined;
  if (value.kind === "session" && hasExactKeys(value, ["kind", "workspaceId", "sessionPath"])) {
    if (!isAbsoluteBoundedPath(value.sessionPath)) return undefined;
    return { kind: "session", workspaceId: value.workspaceId, sessionPath: value.sessionPath };
  }
  if (value.kind === "provisional" && hasExactKeys(value, ["kind", "workspaceId", "draftId"])) {
    if (!isBoundedId(value.draftId, MAX_DRAFT_ID_LENGTH)) return undefined;
    return { kind: "provisional", workspaceId: value.workspaceId, draftId: value.draftId };
  }
  return undefined;
}

export function conversationIdentity(conversation: ConversationKey): string {
  const value = conversation.kind === "session" ? normalizePath(conversation.sessionPath) : conversation.draftId;
  return `${conversation.kind}:${conversation.workspaceId}:${value}`;
}

function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string" && [
    "account",
    "general",
    "providers",
    "packages",
    "extensions",
    "skills",
    "prompts",
    "rules",
    "mcp",
    "integrations",
    "runtime",
    "network",
    "updates",
    "about"
  ].includes(value);
}

export function parseWorkspaces(value: unknown): WorkspaceDescriptor[] | undefined {
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

export function parseWorkbenchSettings(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): WorkbenchSettingsState | undefined {
  if (!isRecordWithAllowedKeys(value, ["section", "scope", "workspaceId"], ["section", "scope"])) return undefined;
  const section = value.section === "resources"
    ? "skills"
    : value.section === "prompts-rules"
      ? "prompts"
      : value.section === "packages"
        ? "extensions"
        : value.section;
  if (!isSettingsSection(section)) return undefined;
  if (value.scope === "global") {
    if (value.workspaceId !== undefined) return undefined;
  } else if (value.scope === "project") {
    if (settingsSectionIsGlobalOnly(section) || !isKnownWorkspaceId(value.workspaceId, workspaceIds)) {
      return undefined;
    }
  } else {
    return undefined;
  }
  return {
    section,
    scope: value.scope,
    ...(typeof value.workspaceId === "string" ? { workspaceId: value.workspaceId } : {})
  };
}

export function parseWorkbenchSurfaceV2(
  value: unknown,
  workspaceIds: ReadonlySet<string>,
  runtimeRecovery: readonly RuntimeRecoveryRecordV2[]
): WorkbenchSurface | undefined {
  if (isRecord(value) && hasExactKeys(value, ["kind"]) && value.kind === "settings") return { kind: "settings" };
  if (isRecord(value) && hasExactKeys(value, ["kind", "workspaceId"]) && value.kind === "workspace"
    && isKnownWorkspaceId(value.workspaceId, workspaceIds)) {
    return { kind: "workspace", workspaceId: value.workspaceId };
  }
  if (isRecord(value) && hasExactKeys(value, ["kind", "conversation"]) && value.kind === "conversation") {
    const conversation = parseConversationKey(value.conversation, workspaceIds);
    if (!conversation) return undefined;
    if (conversation.kind === "provisional" && !runtimeRecovery.some((record) => (
      conversationIdentity(record.conversation) === conversationIdentity(conversation)
    ))) return undefined;
    return { kind: "conversation", conversation };
  }
  return undefined;
}

function parseWorkbenchSurfaceV3(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): WorkbenchSurface | undefined {
  if (isRecord(value) && hasExactKeys(value, ["kind"]) && value.kind === "settings") return { kind: "settings" };
  if (isRecord(value) && hasExactKeys(value, ["kind", "workspaceId"]) && value.kind === "workspace"
    && isKnownWorkspaceId(value.workspaceId, workspaceIds)) {
    return { kind: "workspace", workspaceId: value.workspaceId };
  }
  if (isRecord(value) && hasExactKeys(value, ["kind", "conversation"]) && value.kind === "conversation") {
    const conversation = parseConversationKey(value.conversation, workspaceIds);
    if (conversation?.kind !== "session") return undefined;
    return { kind: "conversation", conversation };
  }
  return undefined;
}

export function selectedSurfaceWorkspaceId(surface: WorkbenchSurface | undefined): string | undefined {
  if (surface?.kind === "workspace") return surface.workspaceId;
  if (surface?.kind === "conversation") return surface.conversation.workspaceId;
  return undefined;
}

export function parseWorkbenchIdSubset(
  value: unknown,
  ids: ReadonlySet<string>,
  maximum: number
): string[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  if (!value.every((id): id is string => typeof id === "string" && ids.has(id))) return undefined;
  return new Set(value).size === value.length ? [...value] : undefined;
}

function taskLifecycleWasLive(lifecycle: TaskLifecycle): boolean {
  return lifecycle === "initializing"
    || lifecycle === "accepted"
    || lifecycle === "running"
    || lifecycle === "waiting-approval"
    || lifecycle === "waiting-extension-input";
}

function settingsSectionIsGlobalOnly(section: SettingsSection): boolean {
  return section === "account"
    || section === "general"
    || section === "mcp"
    || section === "integrations"
    || section === "network"
    || section === "updates"
    || section === "about";
}

export function isKnownWorkspaceId(value: unknown, workspaceIds: ReadonlySet<string>): value is string {
  return isBoundedId(value, MAX_WORKSPACE_ID_LENGTH) && workspaceIds.has(value);
}

function isAbsoluteBoundedPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_WORKSPACE_PATH_LENGTH
    && !value.includes("\0") && isAbsolute(value);
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export function isBoundedId(value: unknown, maximumLength: number): value is string {
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

export function isRecordWithAllowedKeys(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.hasOwn(value, key));
}
