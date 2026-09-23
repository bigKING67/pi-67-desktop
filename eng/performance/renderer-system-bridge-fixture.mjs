export async function installPerformanceSystemBridge(page) {
  await page.addInitScript(() => {
    const workspace = {
      id: "workspace-performance",
      displayName: "pi67-performance-workspace",
      identity: {
        canonicalPath: "/tmp/pi67-performance-workspace",
        assurance: "path-only"
      },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    };
    let workbenchState = {
      version: 5,
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
    Object.defineProperty(window, "pi67", {
      configurable: false,
      value: {
        system: {
          getPlatformInfo: async () => ({ platform: "darwin", architecture: "arm64", version: "performance" }),
          ensureContextPanelRoom: async () => false,
          connectAgentHost: async () => {
            if (!globalThis.__pi67Performance) throw new Error("Performance Agent fixture is not installed.");
            globalThis.__pi67Performance.connect();
          },
          loadWorkbenchState: async () => structuredClone(workbenchState),
          updateWorkbenchLayout: async (layout) => {
            workbenchState = { ...workbenchState, ...structuredClone(layout) };
            return structuredClone(workbenchState);
          },
          pickAndAddWorkspace: async () => {
            workbenchState = {
              ...workbenchState,
              workspaces: [workspace],
              workspaceOrder: [workspace.id],
              expandedWorkspaceIds: [workspace.id],
              workspaceEnvironments: [{
                workspaceId: workspace.id,
                kind: "plain",
                ownership: "user"
              }],
              currentWorkspaceId: workspace.id
            };
            return structuredClone(workspace);
          },
          inspectRepositoryEnvironment: async ({ workspaceId }) => ({
            workspaceId,
            status: "non-git",
            revision: 1,
            observedAt: Date.now(),
            stale: false,
            worktrees: []
          }),
          selectWorkspace: async () => "/tmp/pi67-performance-workspace",
          selectSessionFile: async () => undefined,
          saveDiagnostics: async () => undefined,
          showNativeNotification: async () => true,
          dismissNativeNotification: async () => true,
          onNativeNotificationActivated: () => () => undefined,
          requestOpenExternal: async () => false,
          getUpdateState: async () => ({
            phase: "disabled",
            channel: "unsigned-preview",
            currentVersion: "performance",
            detail: "Performance fixture"
          }),
          checkForUpdates: async () => ({
            phase: "disabled",
            channel: "unsigned-preview",
            currentVersion: "performance",
            detail: "Performance fixture"
          }),
          onUpdateStateChanged: () => () => undefined,
          onAgentHostFailed: () => () => undefined,
          onAgentHostStartup: () => () => undefined,
          completeShutdownCheckpoint: async () => true,
          onShutdownCheckpointRequested: () => () => undefined,
          onPowerResume: () => () => undefined
        }
      }
    });
  });
}
