import {
  MAX_RUNTIME_RECOVERY_RECORDS,
  MAX_SESSION_ID_LENGTH,
  MAX_TASK_ID_LENGTH,
  MAX_WORKSPACES,
  WORKBENCH_STATE_VERSION,
  isBoundedId,
  isKnownWorkspaceId,
  isRecordWithAllowedKeys,
  isTaskLifecycle,
  parseExactWorkbenchIdOrder,
  parseLegacyConversationKey,
  parseWorkbenchIdSubset,
  parseWorkbenchSettings,
  parseWorkspaces,
  plainWorkspaceEnvironmentBindings,
  type LegacyConversationKey,
  type WorkbenchStateV5,
  type WorkbenchSurface
} from "./workbench-state-contract.js";
import {
  parseSessionCreationRecovery,
  type SessionCreationRecoveryRecord
} from "./workbench-state-session-creation.js";

/** Migrates path-keyed v3 state without promoting a persisted path into physical identity. */
export function parseAndMigrateWorkbenchStateV3(value: unknown): WorkbenchStateV5 | undefined {
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
  if (value.version !== 3 || typeof value.cleanExit !== "boolean") return undefined;
  const workspaces = parseWorkspaces(value.workspaces);
  if (!workspaces) return undefined;
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const workspaceOrder = parseExactWorkbenchIdOrder(value.workspaceOrder, workspaceIds, MAX_WORKSPACES);
  const expandedWorkspaceIds = parseWorkbenchIdSubset(value.expandedWorkspaceIds, workspaceIds, MAX_WORKSPACES);
  if (!workspaceOrder || !expandedWorkspaceIds) return undefined;
  if (value.currentWorkspaceId !== undefined && !isKnownWorkspaceId(value.currentWorkspaceId, workspaceIds)) {
    return undefined;
  }
  if (!parseLegacyRuntimeRecovery(value.runtimeRecovery, workspaceIds)) return undefined;
  const sessionCreationRecovery = parseSessionCreationRecovery(
    value.sessionCreationRecovery ?? [],
    workspaceIds,
    MAX_TASK_ID_LENGTH
  );
  const settings = parseWorkbenchSettings(value.settings, workspaceIds);
  if (!sessionCreationRecovery || !settings) return undefined;
  const selectedSurface = value.selectedSurface === undefined
    ? undefined
    : migrateSelectedSurface(value.selectedSurface, workspaceIds, sessionCreationRecovery);
  if (value.selectedSurface !== undefined && !selectedSurface) return undefined;
  const selectedWorkspaceId = selectedSurface?.kind === "workspace"
    ? selectedSurface.workspaceId
    : selectedSurface?.kind === "conversation"
      ? selectedSurface.conversation.workspaceId
      : undefined;
  if (selectedWorkspaceId && value.currentWorkspaceId !== selectedWorkspaceId) return undefined;
  return {
    version: WORKBENCH_STATE_VERSION,
    workspaces,
    workspaceOrder,
    expandedWorkspaceIds,
    ...(typeof value.currentWorkspaceId === "string" ? { currentWorkspaceId: value.currentWorkspaceId } : {}),
    ...(selectedSurface ? { selectedSurface } : {}),
    runtimeRecovery: [],
    sessionCreationRecovery,
    workspaceEnvironments: plainWorkspaceEnvironmentBindings(workspaces),
    environmentMutations: [],
    settings,
    cleanExit: value.cleanExit
  };
}

function parseLegacyRuntimeRecovery(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): boolean {
  if (!Array.isArray(value) || value.length > MAX_RUNTIME_RECOVERY_RECORDS) return false;
  const taskIds = new Set<string>();
  const conversationIds = new Set<string>();
  for (const candidate of value) {
    if (!isRecordWithAllowedKeys(
      candidate,
      [
        "taskId",
        "conversation",
        "sessionId",
        "taskGeneration",
        "sessionGeneration",
        "hostInstanceId",
        "hostEpoch",
        "lastKnownLifecycle"
      ],
      [
        "taskId",
        "conversation",
        "sessionId",
        "taskGeneration",
        "sessionGeneration",
        "hostInstanceId",
        "hostEpoch",
        "lastKnownLifecycle"
      ]
    )) return false;
    const conversation = parseLegacyConversationKey(candidate.conversation, workspaceIds);
    if (
      conversation?.kind !== "session"
      || !isBoundedId(candidate.taskId, MAX_TASK_ID_LENGTH)
      || !isBoundedId(candidate.sessionId, MAX_SESSION_ID_LENGTH)
      || !isPositiveInteger(candidate.taskGeneration)
      || !isPositiveInteger(candidate.sessionGeneration)
      || !isBoundedId(candidate.hostInstanceId, MAX_SESSION_ID_LENGTH)
      || !Number.isSafeInteger(candidate.hostEpoch)
      || Number(candidate.hostEpoch) < 0
      || !isTaskLifecycle(candidate.lastKnownLifecycle)
    ) return false;
    const identity = legacyConversationIdentity(conversation);
    if (taskIds.has(candidate.taskId) || conversationIds.has(identity)) return false;
    taskIds.add(candidate.taskId);
    conversationIds.add(identity);
  }
  return true;
}

function migrateSelectedSurface(
  value: unknown,
  workspaceIds: ReadonlySet<string>,
  creationRecovery: readonly SessionCreationRecoveryRecord[]
): WorkbenchSurface | undefined {
  if (isRecordWithAllowedKeys(value, ["kind"], ["kind"]) && value.kind === "settings") {
    return { kind: "settings" };
  }
  if (isRecordWithAllowedKeys(value, ["kind", "workspaceId"], ["kind", "workspaceId"]) && value.kind === "workspace") {
    return isKnownWorkspaceId(value.workspaceId, workspaceIds)
      ? { kind: "workspace", workspaceId: value.workspaceId }
      : undefined;
  }
  if (!isRecordWithAllowedKeys(value, ["kind", "conversation"], ["kind", "conversation"])
    || value.kind !== "conversation") return undefined;
  const conversation = parseLegacyConversationKey(value.conversation, workspaceIds);
  if (!conversation) return undefined;
  if (conversation.kind === "session") {
    return { kind: "workspace", workspaceId: conversation.workspaceId };
  }
  return creationRecovery.some((record) => (
    record.workspaceId === conversation.workspaceId && record.taskId === conversation.draftId
  ))
    ? { kind: "conversation", conversation }
    : undefined;
}

function legacyConversationIdentity(conversation: LegacyConversationKey): string {
  return conversation.kind === "session"
    ? `session:${conversation.workspaceId}:${normalizeLegacyPath(conversation.sessionPath)}`
    : `provisional:${conversation.workspaceId}:${conversation.draftId}`;
}

function normalizeLegacyPath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
