import type { EnterpriseWorkspaceBinding, TeamSessionIdentity } from "@pi67/domain";

type BoundWorkspace = EnterpriseWorkspaceBinding & { state: "bound"; accountId: string; enterpriseProjectId: string };

/** Model scope comes from Pi birth provenance; governance continues to use Workspace binding. */
export async function resolveSharedReadScope(
  model: { scope?: TeamSessionIdentity } | null | undefined,
  userId: string,
  endpoint: string,
  getBinding: () => Promise<BoundWorkspace>
): Promise<{ accountId: string; enterpriseProjectId: string; workspaceBinding?: BoundWorkspace }> {
  if (model === undefined || model === null) {
    const workspaceBinding = await getBinding();
    return { accountId: workspaceBinding.accountId, enterpriseProjectId: workspaceBinding.enterpriseProjectId, workspaceBinding };
  }
  const scope = model.scope;
  if (!scope) throw new Error("Shared knowledge requires a team Session identity.");
  assertSharedSessionScope(model, { ...scope, userId, endpoint });
  return { accountId: scope.teamId, enterpriseProjectId: scope.projectId };
}

/** Governance reads have no model; model-facing reads must match immutable Session ownership. */
export function assertSharedSessionScope(model: { scope?: TeamSessionIdentity } | null | undefined, expected: TeamSessionIdentity): void {
  if (model === undefined || model === null) return;
  const scope = model.scope;
  if (!scope || scope.userId !== expected.userId || scope.teamId !== expected.teamId || scope.projectId !== expected.projectId) {
    throw new Error("Shared knowledge does not match the team Session identity.");
  }
  let matches = false;
  try { matches = new URL(scope.endpoint).href === new URL(expected.endpoint).href; } catch { /* Reject malformed persisted identity. */ }
  if (!matches) throw new Error("Shared knowledge does not match the team Session service.");
}
