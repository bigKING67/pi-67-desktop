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

export interface RuntimeCapabilities {
  sdkVersion: string;
  supportsFollowUp: true;
  supportsSessionTree: true;
  supportsExtensionUi: true;
  supportsTuiCustomUi: false;
}

export interface DoctorCheck {
  id: "platform" | "node" | "pi-sdk" | "shell" | "git";
  label: string;
  status: "pass" | "warning" | "fail";
  detail: string;
}

export interface DoctorReport {
  generatedAt: number;
  checks: DoctorCheck[];
}
