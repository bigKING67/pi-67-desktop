import type {
  RuntimeRecoveryRecord,
  WorkbenchSettingsState,
  WorkbenchStateV2,
  WorkbenchSurface,
  WorkspaceDescriptor
} from "@pi67/domain";

export type WorkbenchLayoutV2 = {
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  settings: WorkbenchSettingsState;
};

declare global {
  interface Window {
    pi67: {
      system: {
        getPlatformInfo(): Promise<{ platform: "win32" | "darwin"; architecture: "x64" | "arm64"; version: string }>;
        connectAgentHost(): Promise<void>;
        loadWorkbenchState(): Promise<WorkbenchStateV2>;
        updateWorkbenchLayout(layout: WorkbenchLayoutV2): Promise<WorkbenchStateV2>;
        pickAndAddWorkspace(): Promise<WorkspaceDescriptor | undefined>;
        repairWorkspace(workspaceId: string): Promise<WorkspaceDescriptor | undefined>;
        removeWorkspace(workspaceId: string): Promise<WorkbenchStateV2>;
        reorderWorkspaces(workspaceIds: string[]): Promise<WorkbenchStateV2>;
        selectWorkspace(): Promise<string | undefined>;
        selectSessionFile(): Promise<string | undefined>;
        saveDiagnostics(content: string): Promise<string | undefined>;
        showNotification(title: string, body: string): Promise<void>;
        requestOpenExternal(url: string): Promise<boolean>;
        getUpdateState(): Promise<unknown>;
        checkForUpdates(): Promise<unknown>;
        onAgentHostFailed(listener: (state: { code: number; recoverable: boolean; attempt?: number }) => void): () => void;
        onPowerResume(listener: () => void): () => void;
      };
    };
  }
}
