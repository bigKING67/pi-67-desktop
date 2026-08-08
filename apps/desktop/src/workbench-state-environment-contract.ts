import {
  isEnvironmentMutationRecoveryRecord,
  isWorkspaceEnvironmentBinding,
  type EnvironmentMutationRecoveryRecord,
  type WorkspaceDescriptor,
  type WorkspaceEnvironmentBinding
} from "@pi67/protocol";

export function plainWorkspaceEnvironmentBindings(
  workspaces: readonly WorkspaceDescriptor[]
): WorkspaceEnvironmentBinding[] {
  return workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    kind: "plain",
    ownership: "user"
  }));
}

export function parseWorkspaceEnvironmentBindings(
  value: unknown,
  workspaceIds: ReadonlySet<string>,
  maximumWorkspaces: number
): WorkspaceEnvironmentBinding[] | undefined {
  if (
    !Array.isArray(value)
    || value.length !== workspaceIds.size
    || value.length > maximumWorkspaces
  ) return undefined;
  const bindings: WorkspaceEnvironmentBinding[] = [];
  for (const candidate of value) {
    if (!isWorkspaceEnvironmentBinding(candidate) || !workspaceIds.has(candidate.workspaceId)) return undefined;
    if (bindings.some((binding) => binding.workspaceId === candidate.workspaceId)) return undefined;
    bindings.push(candidate);
  }
  return bindings;
}

export function parseEnvironmentMutationRecoveryRecords(
  value: unknown,
  workspaceIds: ReadonlySet<string>,
  maximumRecords: number
): EnvironmentMutationRecoveryRecord[] | undefined {
  if (!Array.isArray(value) || value.length > maximumRecords) return undefined;
  const records: EnvironmentMutationRecoveryRecord[] = [];
  for (const candidate of value) {
    if (!isEnvironmentMutationRecoveryRecord(candidate) || !workspaceIds.has(candidate.sourceWorkspaceId)) {
      return undefined;
    }
    if (candidate.workspaceId !== undefined && !workspaceIds.has(candidate.workspaceId)) return undefined;
    if (records.some((record) => (
      record.creationId === candidate.creationId
      || record.requestId === candidate.requestId
      || (record.repositoryGroupId === candidate.repositoryGroupId && record.worktreeToken === candidate.worktreeToken)
    ))) return undefined;
    records.push(candidate);
  }
  return records;
}
