import {
  conversationIdentity,
  isBoundedId,
  isKnownWorkspaceId,
  isRecordWithAllowedKeys,
  isTaskLifecycle,
  MAX_RUNTIME_RECOVERY_RECORDS,
  MAX_SESSION_ID_LENGTH,
  MAX_TASK_ID_LENGTH,
  MAX_WORKSPACES,
  parseConversationKey,
  parseExactWorkbenchIdOrder,
  parseWorkbenchIdSubset,
  parseWorkbenchSettings,
  parseWorkbenchSurfaceV2,
  parseWorkspaces,
  selectedSurfaceWorkspaceId,
  WORKBENCH_STATE_VERSION,
  parseWorkbenchStateV3,
  type RuntimeRecoveryRecordV2,
  type WorkbenchStateV2,
  type WorkbenchStateV3,
  type WorkbenchSurface
} from "./workbench-state-contract.js";

export function parseWorkbenchStateV2(value: unknown): WorkbenchStateV2 | undefined {
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
  if (value.version !== 2 || typeof value.cleanExit !== "boolean") return undefined;
  const workspaces = parseWorkspaces(value.workspaces);
  if (!workspaces) return undefined;
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const workspaceOrder = parseExactWorkbenchIdOrder(value.workspaceOrder, workspaceIds, MAX_WORKSPACES);
  const expandedWorkspaceIds = parseWorkbenchIdSubset(value.expandedWorkspaceIds, workspaceIds, MAX_WORKSPACES);
  if (!workspaceOrder || !expandedWorkspaceIds) return undefined;
  if (value.currentWorkspaceId !== undefined && !isKnownWorkspaceId(value.currentWorkspaceId, workspaceIds)) {
    return undefined;
  }

  const runtimeRecovery = parseRuntimeRecoveryV2(value.runtimeRecovery, workspaceIds);
  const settings = parseWorkbenchSettings(value.settings, workspaceIds);
  if (!runtimeRecovery || !settings) return undefined;
  const selectedSurface = value.selectedSurface === undefined
    ? undefined
    : parseWorkbenchSurfaceV2(value.selectedSurface, workspaceIds, runtimeRecovery);
  if (value.selectedSurface !== undefined && !selectedSurface) return undefined;
  const selectedWorkspaceId = selectedSurfaceWorkspaceId(selectedSurface);
  if (selectedWorkspaceId && value.currentWorkspaceId !== selectedWorkspaceId) return undefined;

  return {
    version: 2,
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

export function parseAndMigrateWorkbenchStateV2(value: unknown): WorkbenchStateV3 | undefined {
  const legacy = parseWorkbenchStateV2(value);
  if (!legacy) return undefined;
  const selectedSurface = migrateSelectedSurface(legacy.selectedSurface);
  return parseWorkbenchStateV3({
    version: WORKBENCH_STATE_VERSION,
    workspaces: legacy.workspaces,
    workspaceOrder: legacy.workspaceOrder,
    expandedWorkspaceIds: legacy.expandedWorkspaceIds,
    ...(legacy.currentWorkspaceId ? { currentWorkspaceId: legacy.currentWorkspaceId } : {}),
    ...(selectedSurface ? { selectedSurface } : {}),
    runtimeRecovery: [],
    settings: legacy.settings,
    cleanExit: legacy.cleanExit
  });
}

function parseRuntimeRecoveryV2(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): RuntimeRecoveryRecordV2[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_RUNTIME_RECOVERY_RECORDS) return undefined;
  const records: RuntimeRecoveryRecordV2[] = [];
  const taskIds = new Set<string>();
  const conversationIds = new Set<string>();
  for (const candidate of value) {
    if (!isRecordWithAllowedKeys(
      candidate,
      ["taskId", "conversation", "sessionId", "taskGeneration", "lastKnownLifecycle"],
      ["taskId", "conversation", "sessionId", "taskGeneration", "lastKnownLifecycle"]
    )) return undefined;
    const conversation = parseConversationKey(candidate.conversation, workspaceIds);
    if (
      !conversation
      || !isBoundedId(candidate.taskId, MAX_TASK_ID_LENGTH)
      || !isBoundedId(candidate.sessionId, MAX_SESSION_ID_LENGTH)
      || !Number.isSafeInteger(candidate.taskGeneration)
      || Number(candidate.taskGeneration) < 1
      || !isTaskLifecycle(candidate.lastKnownLifecycle)
    ) return undefined;
    const identity = conversationIdentity(conversation);
    if (taskIds.has(candidate.taskId) || conversationIds.has(identity)) return undefined;
    taskIds.add(candidate.taskId);
    conversationIds.add(identity);
    records.push({
      taskId: candidate.taskId,
      conversation,
      sessionId: candidate.sessionId,
      taskGeneration: Number(candidate.taskGeneration),
      lastKnownLifecycle: candidate.lastKnownLifecycle
    });
  }
  return records;
}

function migrateSelectedSurface(surface: WorkbenchSurface | undefined): WorkbenchSurface | undefined {
  if (surface?.kind !== "conversation") return surface;
  return { kind: "workspace", workspaceId: surface.conversation.workspaceId };
}
