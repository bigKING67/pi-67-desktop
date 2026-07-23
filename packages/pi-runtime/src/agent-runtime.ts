import type { ApprovalMode, DoctorReport, SessionSnapshot, SessionSummary, WorkspaceTrust } from "@pi67/domain";
import type { AgentEvent, TransferImage } from "@pi67/protocol";

export interface RuntimeInitializeOptions {
  cwd: string;
  agentDir?: string;
  sessionPath?: string;
  trust: WorkspaceTrust;
  approvalMode: ApprovalMode;
}

export interface AgentRuntime {
  initialize(options: RuntimeInitializeOptions): Promise<SessionSnapshot>;
  dispose(): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  setWorkspacePolicy(trust: WorkspaceTrust, approvalMode: ApprovalMode): void;
  listSessions(all?: boolean): Promise<SessionSummary[]>;
  createSession(cwd: string): Promise<SessionSnapshot>;
  openSession(path: string, cwdOverride?: string): Promise<SessionSnapshot>;
  branch(entryId: string, newFile?: boolean): Promise<SessionSnapshot>;
  rollback(entryId: string, summarize?: boolean): Promise<SessionSnapshot>;
  compact(instructions?: string): Promise<SessionSnapshot>;
  setSessionName(name: string): Promise<SessionSnapshot>;
  send(text: string, images?: TransferImage[]): Promise<void>;
  steer(text: string, images?: TransferImage[]): Promise<void>;
  followUp(text: string, images?: TransferImage[]): Promise<void>;
  abort(): Promise<void>;
  selectModel(provider: string, id: string): Promise<SessionSnapshot>;
  setRuntimeApiKey(provider: string, apiKey: string): Promise<SessionSnapshot>;
  setThinkingLevel(level: string): Promise<SessionSnapshot>;
  reloadResources(): Promise<SessionSnapshot>;
  invokeCommand(command: string): Promise<void>;
  getSnapshot(): SessionSnapshot;
  getCommands(): Array<{ name: string; description?: string }>;
  resolveExtensionUi(requestId: string, value?: string | boolean, cancelled?: boolean): boolean;
  collectDiagnostics(): Promise<Record<string, unknown>>;
  runDoctor(): Promise<DoctorReport>;
}
