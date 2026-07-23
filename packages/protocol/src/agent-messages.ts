import type {
  ApprovalMode,
  DoctorReport,
  ExtensionUiRequestView,
  RuntimeCapabilities,
  RuntimeStatus,
  SessionSnapshot,
  SessionSummary,
  WorkspaceTrust
} from "@pi67/domain";

export interface CommandPayloads {
  "runtime.initialize": {
    cwd: string;
    agentDir?: string;
    sessionPath?: string;
    trust: WorkspaceTrust;
    approvalMode: ApprovalMode;
  };
  "runtime.getStatus": Record<string, never>;
  "workspace.open": { cwd: string; trust: WorkspaceTrust; approvalMode: ApprovalMode };
  "workspace.setTrust": { trust: WorkspaceTrust; approvalMode: ApprovalMode };
  "session.list": { all?: boolean };
  "session.create": { cwd: string };
  "session.open": { path: string; cwdOverride?: string };
  "session.import": { path: string };
  "session.branch": { entryId: string; newFile?: boolean };
  "session.rollback": { entryId: string; summarize?: boolean };
  "session.compact": { instructions?: string };
  "session.name": { name: string };
  "prompt.send": { text: string; images?: TransferImage[] };
  "prompt.steer": { text: string; images?: TransferImage[] };
  "prompt.followUp": { text: string; images?: TransferImage[] };
  "turn.abort": Record<string, never>;
  "model.list": Record<string, never>;
  "model.select": { provider: string; id: string };
  "model.setRuntimeKey": { provider: string; apiKey: string };
  "thinking.set": { level: string };
  "resource.list": Record<string, never>;
  "resource.reload": Record<string, never>;
  "command.list": Record<string, never>;
  "command.invoke": { command: string };
  "extension.ui.respond": { requestId: string; value?: string | boolean; cancelled?: boolean };
  "diagnostics.collect": Record<string, never>;
  "doctor.run": Record<string, never>;
}

export interface TransferImage {
  name: string;
  mimeType: string;
  data: ArrayBuffer;
}

export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_TRANSFER_IMAGE_COUNT = 8;
export const MAX_TRANSFER_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TRANSFER_IMAGE_TOTAL_BYTES = 30 * 1024 * 1024;

export type AgentCommandType = keyof CommandPayloads;

export type AgentCommand<T extends AgentCommandType = AgentCommandType> = {
  [K in T]: { type: K; payload: CommandPayloads[K] };
}[T];

export interface EventPayloads {
  "runtime.statusChanged": RuntimeStatus;
  "runtime.ready": { capabilities: RuntimeCapabilities; snapshot: SessionSnapshot };
  "runtime.crashed": { detail: string; recoverable: boolean };
  "session.snapshot": SessionSnapshot;
  "session.delta": { eventType: string; data: unknown };
  "session.listed": { sessions: SessionSummary[] };
  "session.externalChangeDetected": { path: string };
  "turn.streamBatch": { events: unknown[] };
  "turn.failed": { message: string };
  "approval.requested": ExtensionUiRequestView;
  "approval.resolved": { requestId: string; allowed: boolean };
  "extension.ui.requested": ExtensionUiRequestView;
  "extension.ui.updated": ExtensionUiRequestView;
  "extension.compatibilityChanged": { extensionId: string; status: "partial" | "tui-only" | "failed"; detail: string };
  "resource.changed": { reason: string };
  "diagnostics.progress": { step: string; completed: boolean };
  "doctor.completed": DoctorReport;
}

export type AgentEventType = keyof EventPayloads;

export type AgentEvent<T extends AgentEventType = AgentEventType> = {
  [K in T]: { type: K; payload: EventPayloads[K] };
}[T];

export interface CommandResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}
