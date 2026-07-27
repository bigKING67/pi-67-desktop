export type RuntimePhase =
  | "idle"
  | "starting"
  | "ready"
  | "busy"
  | "recovering"
  | "failed"
  | "stopped";

export interface RuntimeStatus {
  phase: RuntimePhase;
  detail: string;
  recoverable: boolean;
  attempt?: number;
}

export type WorkspaceTrust = "unknown" | "trusted" | "untrusted";
export type ApprovalMode = "guided" | "balanced";

export interface WorkspaceState {
  path: string;
  name: string;
  trust: WorkspaceTrust;
  approvalMode: ApprovalMode;
}

export type ExtensionUiPrimitive =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "notify"
  | "status"
  | "text-widget"
  | "title";

export type ExtensionCompatibility = "native" | "headless" | "adapter" | "partial" | "tui-only" | "unsupported";

export interface RuntimeCapabilities {
  sdkVersion: string;
  supportsFollowUp: true;
  supportsSessionTree: true;
  extensionUi: {
    primitives: ExtensionUiPrimitive[];
    attribution: "none" | "package" | "package-and-path";
    recognizedCompatibilityLevels: ExtensionCompatibility[];
    adapterRegistry: {
      available: boolean;
      manifestSchemaVersions: number[];
      supportedSurfaces: Array<"commands" | "tools">;
      realtimeUiAttribution: false;
      activeAdapterCount: number;
    };
    limitations: {
      workingIndicator: "unsupported";
      editorMutation: "unsupported";
      customComponents: "tui-only";
      autocomplete: "tui-only";
      widgetPlacements: Array<"aboveEditor" | "belowEditor">;
    };
  };
}

export interface DoctorCheck {
  id: "platform" | "node" | "pi-sdk" | "sqlite-runtime" | "session-catalog" | "shell" | "git";
  label: string;
  status: "pass" | "warning" | "fail";
  detail: string;
}

export interface DoctorReport {
  generatedAt: number;
  checks: DoctorCheck[];
}
