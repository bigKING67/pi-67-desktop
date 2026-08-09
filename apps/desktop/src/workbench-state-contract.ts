import { MAX_RUNNING_TASKS } from "@pi67/protocol";
import { MAX_WORKSPACE_ID_LENGTH, parseWorkspaceDescriptor,
  workspaceDescriptorsReferToSameDirectory, type WorkspaceDescriptor } from "./workspace-identity.js";
import type { TaskLifecycle } from "./workbench-state-lifecycle.js";
import { parseRuntimeRecoveryV3 } from "./workbench-state-recovery-v3.js";
import { parseSessionCreationRecovery, type SessionCreationRecoveryRecord } from "./workbench-state-session-creation.js";
import {
  WORKBENCH_STATE_VERSION,
  type ConversationKey,
  type LegacyConversationKey,
  type LegacyWorkbenchSurface,
  type RuntimeRecoveryRecordV2,
  type SettingsSection,
  type WorkbenchSettingsState,
  type WorkbenchStateV4,
  type WorkbenchStateV5,
  type WorkbenchSurface
} from "./workbench-state-types.js";
import {
  parseEnvironmentMutationRecoveryRecords,
  parseWorkspaceEnvironmentBindings
} from "./workbench-state-environment-contract.js";
import {
  hasExactKeys,
  isAbsoluteBoundedPath,
  isBoundedId,
  isBoundedSessionFileIdentity,
  isKnownWorkspaceId,
  isRecord,
  isRecordWithAllowedKeys
} from "./workbench-state-value-contract.js";

export { isTaskLifecycle, type TaskLifecycle } from "./workbench-state-lifecycle.js";
export {
  WORKBENCH_STATE_VERSION,
  type LegacyConversationKey,
  type LegacyWorkbenchSurface,
  type RuntimeRecoveryRecord,
  type RuntimeRecoveryRecordV2,
  type SessionConversationKey,
  type SettingsSection,
  type WorkbenchLayoutV5,
  type WorkbenchLoadResult,
  type WorkbenchSettingsState,
  type WorkbenchStateV2,
  type WorkbenchStateV4,
  type WorkbenchStateV5,
  type WorkbenchSurface
} from "./workbench-state-types.js";
export { plainWorkspaceEnvironmentBindings } from "./workbench-state-environment-contract.js";
export {
  isBoundedId,
  isKnownWorkspaceId,
  isRecordWithAllowedKeys
} from "./workbench-state-value-contract.js";

export const WORKBENCH_STATE_DIRECTORY = "workbench";
export const WORKBENCH_STATE_FILENAME = "state-v5.json";
export const LEGACY_WORKBENCH_STATE_V4_FILENAME = "state-v4.json";
export const LEGACY_WORKBENCH_STATE_V3_FILENAME = "state-v3.json";
export const LEGACY_WORKBENCH_STATE_V2_FILENAME = "state-v2.json";
export const LEGACY_WORKBENCH_STATE_FILENAME = "state-v1.json";
export const MAX_WORKBENCH_STATE_BYTES = 512 * 1024;
export const MAX_WORKSPACES = 100;
export const MAX_RUNTIME_RECOVERY_RECORDS = MAX_RUNNING_TASKS;
export const MAX_ENVIRONMENT_MUTATION_RECORDS = 32;
export const MAX_TASK_ID_LENGTH = 200;
export const MAX_SESSION_ID_LENGTH = 1_024;
const MAX_DRAFT_ID_LENGTH = 200;

export class UnsupportedWorkbenchStateVersionError extends Error {
  readonly foundVersion: number;

  constructor(foundVersion: number) {
    super(`Workbench state version ${foundVersion} is newer than supported version ${WORKBENCH_STATE_VERSION}.`);
    this.name = "UnsupportedWorkbenchStateVersionError";
    this.foundVersion = foundVersion;
  }
}

export function createEmptyWorkbenchState(): WorkbenchStateV5 {
  return {
    version: WORKBENCH_STATE_VERSION,
    workspaces: [],
    workspaceOrder: [],
    expandedWorkspaceIds: [],
    runtimeRecovery: [],
    sessionCreationRecovery: [],
    workspaceEnvironments: [],
    environmentMutations: [],
    settings: { section: "general", scope: "global" },
    cleanExit: false
  };
}

export function beginWorkbenchRun(state: WorkbenchStateV5): WorkbenchStateV5 {
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

export function finishWorkbenchRun(state: WorkbenchStateV5): WorkbenchStateV5 {
  return assertValidWorkbenchState(
    { ...state, runtimeRecovery: [], cleanExit: true },
    "Workbench clean-exit update produced invalid state."
  );
}

export function parseWorkbenchStateV4(value: unknown): WorkbenchStateV4 | undefined {
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
      "sessionCreationRecovery",
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
  if (value.version !== 4 || typeof value.cleanExit !== "boolean") return undefined;
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
  const sessionCreationRecovery = parseSessionCreationRecovery(
    value.sessionCreationRecovery ?? [],
    workspaceIds,
    MAX_TASK_ID_LENGTH
  );
  const settings = parseWorkbenchSettings(value.settings, workspaceIds);
  if (
    !runtimeRecovery
    || !sessionCreationRecovery
    || !settings
    || runtimeRecovery.some((runtime) => (
      sessionCreationRecovery.some((creation) => creation.taskId === runtime.taskId)
    ))
  ) return undefined;
  const selectedSurface = value.selectedSurface === undefined
    ? undefined
    : parseWorkbenchSurfaceV3(value.selectedSurface, workspaceIds, sessionCreationRecovery);
  if (value.selectedSurface !== undefined && !selectedSurface) return undefined;
  const selectedWorkspaceId = selectedSurfaceWorkspaceId(selectedSurface);
  if (selectedWorkspaceId && value.currentWorkspaceId !== selectedWorkspaceId) return undefined;

  return {
    version: 4,
    workspaces,
    workspaceOrder,
    expandedWorkspaceIds,
    ...(typeof value.currentWorkspaceId === "string" ? { currentWorkspaceId: value.currentWorkspaceId } : {}),
    ...(selectedSurface ? { selectedSurface } : {}),
    runtimeRecovery,
    sessionCreationRecovery,
    settings,
    cleanExit: value.cleanExit
  };
}

export function parseWorkbenchStateV5(value: unknown): WorkbenchStateV5 | undefined {
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
      "sessionCreationRecovery",
      "workspaceEnvironments",
      "environmentMutations",
      "settings",
      "cleanExit"
    ],
    [
      "version",
      "workspaces",
      "workspaceOrder",
      "expandedWorkspaceIds",
      "runtimeRecovery",
      "workspaceEnvironments",
      "environmentMutations",
      "settings",
      "cleanExit"
    ]
  ) || value.version !== WORKBENCH_STATE_VERSION) return undefined;
  const {
    workspaceEnvironments: workspaceEnvironmentsValue,
    environmentMutations: environmentMutationsValue,
    ...legacyValue
  } = value;
  const legacy = parseWorkbenchStateV4({ ...legacyValue, version: 4 });
  if (!legacy) return undefined;
  const workspaceIds = new Set(legacy.workspaces.map((workspace) => workspace.id));
  const workspaceEnvironments = parseWorkspaceEnvironmentBindings(
    workspaceEnvironmentsValue,
    workspaceIds,
    MAX_WORKSPACES
  );
  const environmentMutations = parseEnvironmentMutationRecoveryRecords(
    environmentMutationsValue,
    workspaceIds,
    MAX_ENVIRONMENT_MUTATION_RECORDS
  );
  if (!workspaceEnvironments || !environmentMutations) return undefined;
  return {
    ...legacy,
    version: WORKBENCH_STATE_VERSION,
    workspaceEnvironments,
    environmentMutations
  };
}

export function assertValidWorkbenchState(state: WorkbenchStateV5, message: string): WorkbenchStateV5 {
  const parsed = parseWorkbenchStateV5(state);
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

function parseConversationKey(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): ConversationKey | undefined {
  if (!isRecord(value) || !isKnownWorkspaceId(value.workspaceId, workspaceIds)) return undefined;
  if (value.kind === "session" && hasExactKeys(
    value,
    ["kind", "workspaceId", "sessionFileIdentity", "sessionPath"]
  )) {
    if (!isBoundedSessionFileIdentity(value.sessionFileIdentity) || !isAbsoluteBoundedPath(value.sessionPath)) {
      return undefined;
    }
    return {
      kind: "session",
      workspaceId: value.workspaceId,
      sessionFileIdentity: value.sessionFileIdentity,
      sessionPath: value.sessionPath
    };
  }
  if (value.kind === "provisional" && hasExactKeys(value, ["kind", "workspaceId", "draftId"])) {
    if (!isBoundedId(value.draftId, MAX_DRAFT_ID_LENGTH)) return undefined;
    return { kind: "provisional", workspaceId: value.workspaceId, draftId: value.draftId };
  }
  return undefined;
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
    "integrations",
    "runtime",
    "usage",
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
        : value.section === "mcp"
          ? "integrations"
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
): LegacyWorkbenchSurface | undefined {
  if (isRecord(value) && hasExactKeys(value, ["kind"]) && value.kind === "settings") return { kind: "settings" };
  if (isRecord(value) && hasExactKeys(value, ["kind", "workspaceId"]) && value.kind === "workspace"
    && isKnownWorkspaceId(value.workspaceId, workspaceIds)) {
    return { kind: "workspace", workspaceId: value.workspaceId };
  }
  if (isRecord(value) && hasExactKeys(value, ["kind", "conversation"]) && value.kind === "conversation") {
    const conversation = parseLegacyConversationKey(value.conversation, workspaceIds);
    if (!conversation) return undefined;
    if (conversation.kind === "provisional" && !runtimeRecovery.some((record) => (
      record.conversation.kind === "provisional"
      && record.conversation.workspaceId === conversation.workspaceId
      && record.conversation.draftId === conversation.draftId
    ))) return undefined;
    return { kind: "conversation", conversation };
  }
  return undefined;
}

function parseWorkbenchSurfaceV3(
  value: unknown,
  workspaceIds: ReadonlySet<string>,
  sessionCreationRecovery: readonly SessionCreationRecoveryRecord[]
): WorkbenchSurface | undefined {
  if (isRecord(value) && hasExactKeys(value, ["kind"]) && value.kind === "settings") return { kind: "settings" };
  if (isRecord(value) && hasExactKeys(value, ["kind", "workspaceId"]) && value.kind === "workspace"
    && isKnownWorkspaceId(value.workspaceId, workspaceIds)) {
    return { kind: "workspace", workspaceId: value.workspaceId };
  }
  if (isRecord(value) && hasExactKeys(value, ["kind", "conversation"]) && value.kind === "conversation") {
    const conversation = parseConversationKey(value.conversation, workspaceIds);
    if (!conversation) return undefined;
    if (
      conversation.kind === "provisional"
      && !sessionCreationRecovery.some((record) => (
        record.workspaceId === conversation.workspaceId
        && record.taskId === conversation.draftId
      ))
    ) return undefined;
    return { kind: "conversation", conversation };
  }
  return undefined;
}

export function selectedSurfaceWorkspaceId(
  surface: WorkbenchSurface | LegacyWorkbenchSurface | undefined
): string | undefined {
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
    || section === "integrations"
    || section === "network"
    || section === "updates"
    || section === "about";
}

export function parseLegacyConversationKey(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): LegacyConversationKey | undefined {
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
