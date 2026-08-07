import type {
  PreviousRunExitStatus,
  RuntimeRecoveryRecord,
  SessionCreationRecoveryRecord,
  SettingsSection,
  WorkbenchSurface
} from "../../packages/domain/src/index.js";

export interface MockWorkspaceDescriptor {
  id: string;
  displayName: string;
  identity: {
    canonicalPath: string;
    device?: string;
    inode?: string;
    birthtimeNs?: string;
    assurance: "filesystem" | "path-only";
  };
  lastVerifiedAt?: number;
  trust: "unknown" | "trusted" | "untrusted";
  trustProvenance: "native-picker" | "user-confirmed" | "restored" | "identity-changed" | "indirect";
  availability: "available" | "missing" | "identity-changed" | "needs-confirmation" | "unavailable";
}

export interface MockDesktopBridgeOptions {
  previousRunExitStatus?: PreviousRunExitStatus;
  initialWorkspaces?: MockWorkspaceDescriptor[];
  pickerQueue?: MockWorkspaceDescriptor[];
  initialRuntimeRecovery?: RuntimeRecoveryRecord[];
  initialSessionCreationRecovery?: SessionCreationRecoveryRecord[];
  expandedWorkspaceIds?: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  settings?: {
    section: SettingsSection;
    scope: "global" | "project";
    workspaceId?: string;
  };
  capabilityInitializingCalls?: number;
  deferInitialUpdateState?: boolean;
}

export const DEFAULT_MOCK_WORKSPACE: MockWorkspaceDescriptor = {
  id: "workspace-pi-demo",
  displayName: "pi-demo",
  identity: {
    canonicalPath: "/Users/test/Projects/pi-demo",
    device: "1",
    inode: "67",
    birthtimeNs: "1",
    assurance: "filesystem"
  },
  trust: "trusted",
  trustProvenance: "native-picker",
  availability: "available"
};
