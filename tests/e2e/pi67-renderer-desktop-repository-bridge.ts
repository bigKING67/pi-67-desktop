import type { Page } from "@playwright/test";
import type {
  DesktopSystemBridge,
  RepositoryChangeDetailRequest,
  RepositoryEnvironmentSnapshot,
  RepositoryWorkingTreeInspectionRequest
} from "@pi67/protocol";

export type MockDesktopRepositoryBridge = Pick<DesktopSystemBridge,
  | "inspectRepositoryEnvironment"
  | "initializeRepositorySubmodules"
  | "recoverAppOwnedWorktree"
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
    let currentRepositorySnapshot = repositorySnapshot
      ? structuredClone(repositorySnapshot)
      : undefined;
    const repositoryActionTest = {
      initializeCalls: 0,
      recoveryCalls: 0
    };
    (window as unknown as { __pi67RepositoryActionTest: typeof repositoryActionTest })
      .__pi67RepositoryActionTest = repositoryActionTest;
    const repositoryBridge = {
      inspectRepositoryEnvironment: async ({ workspaceId }: { workspaceId: string }) => ({
        ...(currentRepositorySnapshot
          ? structuredClone(currentRepositorySnapshot)
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
      initializeRepositorySubmodules: async () => {
        repositoryActionTest.initializeCalls += 1;
        const complete = {
          status: "complete" as const,
          total: 1,
          uninitialized: 0,
          divergent: 0,
          conflicted: 0,
          networkActionRequired: false
        };
        if (currentRepositorySnapshot?.status === "ready") {
          currentRepositorySnapshot = { ...currentRepositorySnapshot, submodules: complete };
        }
        return { status: "initialized" as const, submodules: complete };
      },
      recoverAppOwnedWorktree: async () => {
        repositoryActionTest.recoveryCalls += 1;
        return {
          status: "rejected" as const,
          error: "not-recoverable" as const,
          recoverable: false
        };
      },
      readRepositoryChangeDetail: async (request: RepositoryChangeDetailRequest) => {
        throw new Error(`Mock repository change ${request.changeId} was not found.`);
      }
    } satisfies MockDesktopRepositoryBridge;
    Object.assign(systemFixture.methods, repositoryBridge);
  }, snapshot);
}
