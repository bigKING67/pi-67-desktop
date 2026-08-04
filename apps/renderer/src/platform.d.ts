import type {
  PackageNetworkSettings,
  PackageNetworkSnapshot,
  DesktopCapabilitySnapshot,
  RuntimeRecoveryRecord,
  WorkspaceEntryContextAction,
  WorkspaceEntryRequest,
  WorkspaceFilePersistedState,
  WorkspaceFileStateSnapshot,
  WorkbenchSettingsState,
  WorkbenchStateV3,
  WorkbenchSurface,
  WorkspaceDescriptor
} from "@pi67/domain";
import type { StagedPromptAttachment } from "@pi67/protocol";

export type TeamMcpStatus = {
  serverName: string;
  url: string;
  tokenEnv: string;
  configured: boolean;
  tokenPrefix?: string;
  tokenPath: string;
};

export type TeamMcpRevealResult =
  | { status: "revealed"; token: string }
  | { status: "missing" };

export type WorkbenchLayoutV3 = {
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
        connectAgentHost(options?: { replaceCurrent?: boolean }): Promise<void>;
        stagePromptAttachments(files: File[]): Promise<StagedPromptAttachment[]>;
        releasePromptAttachments(ids: string[]): Promise<void>;
        loadWorkbenchState(): Promise<WorkbenchStateV3>;
        loadWorkspaceFileState(): Promise<WorkspaceFileStateSnapshot>;
        updateWorkspaceFileState(state: WorkspaceFilePersistedState): Promise<WorkspaceFileStateSnapshot>;
        updateWorkbenchLayout(layout: WorkbenchLayoutV3): Promise<WorkbenchStateV3>;
        pickAndAddWorkspace(): Promise<WorkspaceDescriptor | undefined>;
        repairWorkspace(workspaceId: string): Promise<WorkspaceDescriptor | undefined>;
        removeWorkspace(workspaceId: string): Promise<WorkbenchStateV3>;
        reorderWorkspaces(workspaceIds: string[]): Promise<WorkbenchStateV3>;
        selectWorkspace(): Promise<string | undefined>;
        selectSessionFile(): Promise<string | undefined>;
        saveDiagnostics(content: string): Promise<string | undefined>;
        showNotification(title: string, body: string): Promise<void>;
        requestOpenExternal(url: string): Promise<boolean>;
        showWorkspaceEntryContextMenu(entry: WorkspaceEntryRequest): Promise<WorkspaceEntryContextAction | undefined>;
        revealWorkspaceEntry(entry: WorkspaceEntryRequest): Promise<boolean>;
        openWorkspaceEntryInDefaultApp(entry: WorkspaceEntryRequest): Promise<boolean>;
        copyWorkspaceEntryPath(entry: WorkspaceEntryRequest, mode: "absolute" | "relative"): Promise<boolean>;
        trashWorkspaceEntry(entry: WorkspaceEntryRequest): Promise<boolean>;
        getPackageNetworkSnapshot(): Promise<PackageNetworkSnapshot>;
        savePackageNetworkSettings(settings: PackageNetworkSettings): Promise<PackageNetworkSnapshot>;
        resetPackageNetworkSettings(): Promise<PackageNetworkSnapshot>;
        probePackageSources(settings: PackageNetworkSettings): Promise<PackageNetworkSnapshot>;
        getDesktopCapabilitySnapshot(): Promise<DesktopCapabilitySnapshot>;
        setupBrowser67(): Promise<DesktopCapabilitySnapshot>;
        doctorBrowser67(): Promise<DesktopCapabilitySnapshot>;
        prepareBrowser67Extension(): Promise<DesktopCapabilitySnapshot>;
        openBrowser67ExtensionPage(browser: "chrome" | "edge"): Promise<boolean>;
        revealBrowser67Extension(): Promise<boolean>;
        copyBrowser67ExtensionPath(): Promise<boolean>;
        verifyBrowser67Extension(options: { startHub: boolean }): Promise<DesktopCapabilitySnapshot>;
        getTeamMcpStatus(): Promise<TeamMcpStatus>;
        revealTeamMcpToken(): Promise<TeamMcpRevealResult>;
        saveTeamMcpToken(token: string): Promise<TeamMcpStatus>;
        clearTeamMcpToken(): Promise<TeamMcpStatus>;
        getUpdateState(): Promise<unknown>;
        checkForUpdates(): Promise<unknown>;
        onUpdateStateChanged(listener: (state: unknown) => void): () => void;
        onAgentHostFailed(listener: (state: { code: number; recoverable: boolean; attempt?: number }) => void): () => void;
        onPowerResume(listener: () => void): () => void;
      };
    };
  }
}
