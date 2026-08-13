import type { Page } from "@playwright/test";
import type {
  DesktopSystemBridge,
  RepositoryChangeDetailRequest,
  RepositoryEnvironmentSnapshot,
  RepositoryWorkingTreeInspectionRequest
} from "@pi67/protocol";

export type MockDesktopRepositoryBridge = Pick<DesktopSystemBridge,
  | "inspectRepositoryEnvironment"
  | "inspectRepositoryWorkingTree"
  | "readRepositoryChangeDetail"
>;

export async function installMockDesktopRepositoryBridge(
  page: Page,
  snapshot?: RepositoryEnvironmentSnapshot
): Promise<void> {
  await page.addInitScript((repositorySnapshot) => {
    type SystemFixtureRegistry = { methods: Partial<DesktopSystemBridge> };
    const fixtureWindow = window as unknown as { __pi67SystemFixture?: SystemFixtureRegistry };
    const systemFixture = fixtureWindow.__pi67SystemFixture ??= { methods: {} };
    const repositoryBridge = {
      inspectRepositoryEnvironment: async ({ workspaceId }: { workspaceId: string }) => ({
        ...(repositorySnapshot
          ? structuredClone(repositorySnapshot)
          : {
              workspaceId,
              status: "non-git" as const,
              revision: 1,
              observedAt: Date.now(),
              stale: false,
              worktrees: []
            }),
        workspaceId
      }),
      inspectRepositoryWorkingTree: async ({ workspaceId }: RepositoryWorkingTreeInspectionRequest) => ({
        workspaceId,
        revision: 1,
        observedAt: Date.now(),
        changes: [],
        truncated: false
      }),
      readRepositoryChangeDetail: async (request: RepositoryChangeDetailRequest) => {
        throw new Error(`Mock repository change ${request.changeId} was not found.`);
      }
    } satisfies MockDesktopRepositoryBridge;
    Object.assign(systemFixture.methods, repositoryBridge);
  }, snapshot);
}
