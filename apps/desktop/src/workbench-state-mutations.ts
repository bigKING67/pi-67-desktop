import type { WorkspaceDescriptor } from "./workspace-identity.js";
import {
  advanceEnvironmentCreation,
  isEnvironmentMutationRecoveryRecord,
  type EnvironmentCreationState,
  type EnvironmentMutationRecoveryRecord,
  type WorkspaceEnvironmentKind
} from "@pi67/protocol";
import {
  MAX_ENVIRONMENT_MUTATION_RECORDS,
  MAX_WORKSPACES,
  WORKBENCH_STATE_VERSION,
  assertValidWorkbenchState,
  assertWorkbenchId,
  parseExactWorkbenchIdOrder,
  parseWorkbenchStateV5,
  type WorkbenchLayoutV5,
  type WorkbenchStateV5
} from "./workbench-state-contract.js";
import {
  refreshNativeWorkspaceDescriptor,
  workspaceDescriptorsReferToSameDirectory,
  type NativeWorkspaceDescriptor
} from "./workspace-identity.js";

export function addOrRefreshWorkspace(
  state: WorkbenchStateV5,
  selected: NativeWorkspaceDescriptor
): { state: WorkbenchStateV5; workspace: NativeWorkspaceDescriptor } {
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
  const next: WorkbenchStateV5 = {
    ...state,
    workspaces,
    workspaceOrder,
    workspaceEnvironments: existingIndex === -1
      ? [...state.workspaceEnvironments, { workspaceId: workspace.id, kind: "plain", ownership: "user" }]
      : state.workspaceEnvironments,
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
  state: WorkbenchStateV5,
  workspaceId: string,
  selected: NativeWorkspaceDescriptor
): { state: WorkbenchStateV5; workspace: NativeWorkspaceDescriptor } {
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
  state: WorkbenchStateV5,
  workspaces: readonly WorkspaceDescriptor[]
): WorkbenchStateV5 {
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

export function recordObservedWorkspaceEnvironment(
  state: WorkbenchStateV5,
  observation: {
    workspaceId: string;
    kind: Exclude<WorkspaceEnvironmentKind, "plain">;
    repositoryGroupId: string;
  }
): WorkbenchStateV5 {
  assertWorkbenchId(observation.workspaceId, "Workspace id");
  const bindingIndex = state.workspaceEnvironments.findIndex((binding) => (
    binding.workspaceId === observation.workspaceId
  ));
  if (bindingIndex === -1) throw new Error("Workspace environment binding was not found.");
  const current = state.workspaceEnvironments[bindingIndex]!;
  if (current.ownership === "app" && (
    observation.kind !== "repository-worktree"
    || current.repositoryGroupId !== observation.repositoryGroupId
  )) {
    throw new Error("App-owned Workspace environment identity changed.");
  }
  const nextBinding = {
    workspaceId: current.workspaceId,
    kind: observation.kind,
    ownership: current.ownership,
    repositoryGroupId: observation.repositoryGroupId,
    ...(current.creationId ? { creationId: current.creationId } : {})
  };
  if (
    current.kind === nextBinding.kind
    && current.repositoryGroupId === nextBinding.repositoryGroupId
    && current.ownership === nextBinding.ownership
    && current.creationId === nextBinding.creationId
  ) return state;
  const workspaceEnvironments = [...state.workspaceEnvironments];
  workspaceEnvironments[bindingIndex] = nextBinding;
  return assertValidWorkbenchState(
    { ...state, workspaceEnvironments },
    "Observed Workspace environment binding is invalid."
  );
}

export function reserveEnvironmentMutation(
  state: WorkbenchStateV5,
  record: EnvironmentMutationRecoveryRecord
): WorkbenchStateV5 {
  if (record.state !== "reserved" || !isEnvironmentMutationRecoveryRecord(record)) {
    throw new Error("Environment mutation reservation is invalid.");
  }
  if (state.environmentMutations.length >= MAX_ENVIRONMENT_MUTATION_RECORDS) {
    throw new Error("Environment mutation recovery limit reached.");
  }
  const sourceBinding = state.workspaceEnvironments.find((binding) => (
    binding.workspaceId === record.sourceWorkspaceId
  ));
  if (
    !sourceBinding
    || sourceBinding.kind === "plain"
    || sourceBinding.repositoryGroupId !== record.repositoryGroupId
  ) throw new Error("Environment mutation source binding is not ready.");
  if (state.environmentMutations.some((current) => (
    current.creationId === record.creationId
    || current.requestId === record.requestId
    || (current.repositoryGroupId === record.repositoryGroupId && current.worktreeToken === record.worktreeToken)
  ))) throw new Error("Environment mutation identity already exists.");
  return assertValidWorkbenchState(
    { ...state, environmentMutations: [...state.environmentMutations, record] },
    "Environment mutation reservation produced invalid Workbench state."
  );
}

export function advanceEnvironmentMutation(
  state: WorkbenchStateV5,
  creationId: string,
  next: EnvironmentCreationState,
  updatedAt: number,
  patch: {
    workspaceId?: string | undefined;
    sessionFileIdentity?: string | undefined;
    rollbackSafety?: EnvironmentMutationRecoveryRecord["rollbackSafety"] | undefined;
  } = {}
): WorkbenchStateV5 {
  const index = state.environmentMutations.findIndex((record) => record.creationId === creationId);
  if (index === -1) throw new Error("Environment mutation recovery record was not found.");
  const environmentMutations = [...state.environmentMutations];
  environmentMutations[index] = advanceEnvironmentCreation(environmentMutations[index]!, next, updatedAt, patch);
  return assertValidWorkbenchState(
    { ...state, environmentMutations },
    "Environment mutation transition produced invalid Workbench state."
  );
}

export function registerCreatedWorktreeWorkspace(
  state: WorkbenchStateV5,
  creationId: string,
  workspace: WorkspaceDescriptor,
  updatedAt: number
): WorkbenchStateV5 {
  const record = state.environmentMutations.find((candidate) => candidate.creationId === creationId);
  if (!record || record.state !== "git-materialized") {
    throw new Error("Worktree creation is not ready for Workspace registration.");
  }
  if (state.workspaces.length >= MAX_WORKSPACES) throw new Error("Workspace registration limit reached.");
  if (
    state.workspaces.some((current) => (
      current.id === workspace.id || workspaceDescriptorsReferToSameDirectory(current, workspace)
    ))
    || workspace.trust !== "trusted"
    || workspace.trustProvenance !== "indirect"
    || workspace.availability !== "available"
  ) throw new Error("Created Worktree Workspace identity is invalid or already registered.");
  const nextRecord = advanceEnvironmentCreation(record, "workspace-registered", updatedAt, {
    workspaceId: workspace.id
  });
  return assertValidWorkbenchState({
    ...state,
    workspaces: [...state.workspaces, workspace],
    workspaceOrder: [...state.workspaceOrder, workspace.id],
    workspaceEnvironments: [
      ...state.workspaceEnvironments,
      {
        workspaceId: workspace.id,
        kind: "repository-worktree",
        ownership: "app",
        repositoryGroupId: record.repositoryGroupId,
        creationId
      }
    ],
    environmentMutations: state.environmentMutations.map((candidate) => (
      candidate.creationId === creationId ? nextRecord : candidate
    ))
  }, "Created Worktree registration produced invalid Workbench state.");
}

export function restoreAppOwnedWorktreeWorkspace(
  state: WorkbenchStateV5,
  creationId: string,
  workspace: WorkspaceDescriptor
): WorkbenchStateV5 {
  const index = state.workspaces.findIndex((candidate) => candidate.id === workspace.id);
  const binding = state.workspaceEnvironments.find((candidate) => candidate.workspaceId === workspace.id);
  const record = state.environmentMutations.find((candidate) => candidate.creationId === creationId);
  if (
    index === -1
    || binding?.kind !== "repository-worktree"
    || binding.ownership !== "app"
    || binding.creationId !== creationId
    || record?.workspaceId !== workspace.id
    || record.state !== "committed"
    || workspace.trust !== "trusted"
    || workspace.trustProvenance !== "indirect"
    || workspace.availability !== "available"
  ) throw new Error("App-owned Worktree recovery authority is invalid.");
  const workspaces = [...state.workspaces];
  workspaces[index] = workspace;
  return assertValidWorkbenchState(
    { ...state, workspaces },
    "App-owned Worktree recovery produced invalid Workbench state."
  );
}

export function removeWorkspaceRegistration(state: WorkbenchStateV5, workspaceId: string): WorkbenchStateV5 {
  assertWorkbenchId(workspaceId, "Workspace id");
  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) return state;
  if (state.environmentMutations.some((record) => (
    record.sourceWorkspaceId === workspaceId || record.workspaceId === workspaceId
  ))) {
    throw new Error("Workspace is referenced by Worktree recovery state.");
  }
  return removeWorkspaceRegistrationState(state, workspaceId, state.environmentMutations);
}

export function finalizeRolledBackWorktreeWorkspace(
  state: WorkbenchStateV5,
  creationId: string,
  workspaceId: string,
  updatedAt: number
): WorkbenchStateV5 {
  assertWorkbenchId(workspaceId, "Workspace id");
  const record = state.environmentMutations.find((candidate) => candidate.creationId === creationId);
  const binding = state.workspaceEnvironments.find((candidate) => candidate.workspaceId === workspaceId);
  if (
    !record
    || record.state !== "rollback-pending"
    || record.rollbackSafety !== "pre-host-confirmed"
    || record.workspaceId !== workspaceId
    || !state.workspaces.some((workspace) => workspace.id === workspaceId)
    || binding?.kind !== "repository-worktree"
    || binding.ownership !== "app"
    || binding.creationId !== creationId
    || binding.repositoryGroupId !== record.repositoryGroupId
    || state.runtimeRecovery.some((candidate) => candidate.conversation.workspaceId === workspaceId)
    || state.sessionCreationRecovery.some((candidate) => candidate.workspaceId === workspaceId)
  ) throw new Error("Worktree rollback Workspace authority is not safe to retire.");
  const rolledBack = advanceEnvironmentCreation(record, "rolled-back", updatedAt, {
    workspaceId: undefined
  });
  const environmentMutations = state.environmentMutations.map((candidate) => (
    candidate.creationId === creationId ? rolledBack : candidate
  ));
  return removeWorkspaceRegistrationState(state, workspaceId, environmentMutations);
}

function removeWorkspaceRegistrationState(
  state: WorkbenchStateV5,
  workspaceId: string,
  environmentMutations: readonly EnvironmentMutationRecoveryRecord[]
): WorkbenchStateV5 {
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
  const next: WorkbenchStateV5 = {
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
    workspaceEnvironments: state.workspaceEnvironments.filter((binding) => binding.workspaceId !== workspaceId),
    environmentMutations: [...environmentMutations],
    settings,
    cleanExit: state.cleanExit
  };
  return assertValidWorkbenchState(next, "Workspace removal produced invalid workbench state.");
}

export function reorderWorkspaceRegistrations(
  state: WorkbenchStateV5,
  workspaceIds: readonly string[]
): WorkbenchStateV5 {
  const expected = new Set(state.workspaceOrder);
  const workspaceOrder = parseExactWorkbenchIdOrder(workspaceIds, expected, MAX_WORKSPACES);
  if (!workspaceOrder) throw new Error("Workspace order must be an exact permutation.");
  return { ...state, workspaceOrder };
}

export function replaceWorkbenchLayout(state: WorkbenchStateV5, value: unknown): WorkbenchStateV5 {
  const layout = parseWorkbenchLayout(value, state);
  if (!layout) throw new Error("Workbench layout is invalid.");
  const next: WorkbenchStateV5 = {
    version: WORKBENCH_STATE_VERSION,
    workspaces: state.workspaces,
    workspaceOrder: state.workspaceOrder,
    workspaceEnvironments: state.workspaceEnvironments,
    environmentMutations: state.environmentMutations,
    ...layout,
    cleanExit: state.cleanExit
  };
  return assertValidWorkbenchState(next, "Workbench layout is invalid.");
}

function parseWorkbenchLayout(
  value: unknown,
  state: Pick<
    WorkbenchStateV5,
    "workspaces" | "workspaceOrder" | "workspaceEnvironments" | "environmentMutations"
  >
): WorkbenchLayoutV5 | undefined {
  if (!isWorkbenchLayoutRecord(value)) return undefined;
  const candidate = {
    version: WORKBENCH_STATE_VERSION,
    workspaces: state.workspaces,
    workspaceOrder: state.workspaceOrder,
    workspaceEnvironments: state.workspaceEnvironments,
    environmentMutations: state.environmentMutations,
    ...value,
    cleanExit: false
  };
  const parsed = parseWorkbenchStateV5(candidate);
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
