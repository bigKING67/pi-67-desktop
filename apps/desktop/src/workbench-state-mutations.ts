import type { WorkspaceDescriptor } from "./workspace-identity.js";
import {
  MAX_WORKSPACES,
  WORKBENCH_STATE_VERSION,
  assertValidWorkbenchState,
  assertWorkbenchId,
  parseExactWorkbenchIdOrder,
  parseWorkbenchStateV4,
  type WorkbenchLayoutV4,
  type WorkbenchStateV4
} from "./workbench-state-contract.js";
import {
  refreshNativeWorkspaceDescriptor,
  workspaceDescriptorsReferToSameDirectory,
  type NativeWorkspaceDescriptor
} from "./workspace-identity.js";

export function addOrRefreshWorkspace(
  state: WorkbenchStateV4,
  selected: NativeWorkspaceDescriptor
): { state: WorkbenchStateV4; workspace: NativeWorkspaceDescriptor } {
  const existingIndex = state.workspaces.findIndex((workspace) => (
    workspaceDescriptorsReferToSameDirectory(workspace, selected)
  ));
  const workspace = existingIndex === -1
    ? selected
    : refreshNativeWorkspaceDescriptor(state.workspaces[existingIndex]!, selected);
  const workspaces = [...state.workspaces];
  const workspaceOrder = [...state.workspaceOrder];
  if (existingIndex === -1) {
    if (workspaces.length >= MAX_WORKSPACES) throw new Error("Workspace registration limit reached.");
    workspaces.push(workspace);
    workspaceOrder.push(workspace.id);
  } else {
    workspaces[existingIndex] = workspace;
  }
  const firstRegistration = state.currentWorkspaceId === undefined;
  const next: WorkbenchStateV4 = {
    ...state,
    workspaces,
    workspaceOrder,
    expandedWorkspaceIds: firstRegistration
      ? [workspace.id]
      : state.expandedWorkspaceIds,
    ...(firstRegistration ? { currentWorkspaceId: workspace.id } : {})
  };
  return {
    state: assertValidWorkbenchState(next, "Workspace registration produced invalid workbench state."),
    workspace
  };
}

export function repairWorkspaceRegistration(
  state: WorkbenchStateV4,
  workspaceId: string,
  selected: NativeWorkspaceDescriptor
): { state: WorkbenchStateV4; workspace: NativeWorkspaceDescriptor } {
  assertWorkbenchId(workspaceId, "Workspace id");
  const existingIndex = state.workspaces.findIndex((workspace) => workspace.id === workspaceId);
  if (existingIndex === -1) throw new Error("Workspace registration was not found.");
  const duplicate = state.workspaces.find((workspace, index) => (
    index !== existingIndex && workspaceDescriptorsReferToSameDirectory(workspace, selected)
  ));
  if (duplicate) throw new Error("Selected directory is already registered as another workspace.");

  const workspace = refreshNativeWorkspaceDescriptor(state.workspaces[existingIndex]!, selected);
  const workspaces = [...state.workspaces];
  workspaces[existingIndex] = workspace;
  return {
    state: assertValidWorkbenchState(
      { ...state, workspaces },
      "Workspace repair produced invalid workbench state."
    ),
    workspace
  };
}

export function replaceWorkspaceRegistrations(
  state: WorkbenchStateV4,
  workspaces: readonly WorkspaceDescriptor[]
): WorkbenchStateV4 {
  if (
    workspaces.length !== state.workspaces.length
    || workspaces.some((workspace, index) => workspace.id !== state.workspaces[index]?.id)
  ) {
    throw new Error("Workspace refresh must preserve registration identity and order.");
  }
  return assertValidWorkbenchState(
    { ...state, workspaces: [...workspaces] },
    "Workspace refresh produced invalid workbench state."
  );
}

export function removeWorkspaceRegistration(state: WorkbenchStateV4, workspaceId: string): WorkbenchStateV4 {
  assertWorkbenchId(workspaceId, "Workspace id");
  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) return state;
  const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
  const workspaceOrder = state.workspaceOrder.filter((id) => id !== workspaceId);
  const currentWorkspaceId = state.currentWorkspaceId === workspaceId
    ? workspaceOrder[0]
    : state.currentWorkspaceId;
  const selectedRemoved = (state.selectedSurface?.kind === "conversation"
    && state.selectedSurface.conversation.workspaceId === workspaceId)
    || (state.selectedSurface?.kind === "workspace" && state.selectedSurface.workspaceId === workspaceId);
  const settings = state.settings.workspaceId === workspaceId
    ? { section: state.settings.section, scope: "global" as const }
    : state.settings;
  const selectedSurface = selectedRemoved
    ? (currentWorkspaceId ? { kind: "workspace" as const, workspaceId: currentWorkspaceId } : undefined)
    : state.selectedSurface;
  const next: WorkbenchStateV4 = {
    version: WORKBENCH_STATE_VERSION,
    workspaces,
    workspaceOrder,
    expandedWorkspaceIds: state.expandedWorkspaceIds.filter((id) => id !== workspaceId),
    ...(currentWorkspaceId ? { currentWorkspaceId } : {}),
    ...(selectedSurface ? { selectedSurface } : {}),
    runtimeRecovery: state.runtimeRecovery.filter((record) => record.conversation.workspaceId !== workspaceId),
    sessionCreationRecovery: state.sessionCreationRecovery.filter((record) => (
      record.workspaceId !== workspaceId
    )),
    settings,
    cleanExit: state.cleanExit
  };
  return assertValidWorkbenchState(next, "Workspace removal produced invalid workbench state.");
}

export function reorderWorkspaceRegistrations(
  state: WorkbenchStateV4,
  workspaceIds: readonly string[]
): WorkbenchStateV4 {
  const expected = new Set(state.workspaceOrder);
  const workspaceOrder = parseExactWorkbenchIdOrder(workspaceIds, expected, MAX_WORKSPACES);
  if (!workspaceOrder) throw new Error("Workspace order must be an exact permutation.");
  return { ...state, workspaceOrder };
}

export function replaceWorkbenchLayout(state: WorkbenchStateV4, value: unknown): WorkbenchStateV4 {
  const layout = parseWorkbenchLayout(value, state.workspaces, state.workspaceOrder);
  if (!layout) throw new Error("Workbench layout is invalid.");
  const next: WorkbenchStateV4 = {
    version: WORKBENCH_STATE_VERSION,
    workspaces: state.workspaces,
    workspaceOrder: state.workspaceOrder,
    ...layout,
    cleanExit: state.cleanExit
  };
  return assertValidWorkbenchState(next, "Workbench layout is invalid.");
}

function parseWorkbenchLayout(
  value: unknown,
  workspaces: readonly WorkspaceDescriptor[],
  workspaceOrder: readonly string[]
): WorkbenchLayoutV4 | undefined {
  if (!isWorkbenchLayoutRecord(value)) return undefined;
  const candidate = {
    version: WORKBENCH_STATE_VERSION,
    workspaces,
    workspaceOrder,
    ...value,
    cleanExit: false
  };
  const parsed = parseWorkbenchStateV4(candidate);
  if (!parsed) return undefined;
  return {
    expandedWorkspaceIds: parsed.expandedWorkspaceIds,
    ...(parsed.currentWorkspaceId ? { currentWorkspaceId: parsed.currentWorkspaceId } : {}),
    ...(parsed.selectedSurface ? { selectedSurface: parsed.selectedSurface } : {}),
    runtimeRecovery: parsed.runtimeRecovery,
    sessionCreationRecovery: parsed.sessionCreationRecovery,
    settings: parsed.settings
  };
}

function isWorkbenchLayoutRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const allowed = [
    "expandedWorkspaceIds",
    "currentWorkspaceId",
    "selectedSurface",
    "runtimeRecovery",
    "sessionCreationRecovery",
    "settings"
  ];
  const required = [
    "expandedWorkspaceIds",
    "runtimeRecovery",
    "sessionCreationRecovery",
    "settings"
  ];
  const actual = Object.keys(value);
  return actual.every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(value, key));
}
