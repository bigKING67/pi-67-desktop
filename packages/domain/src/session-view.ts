export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface TextPart {
  type: "text" | "thinking";
  text: string;
}

export interface ToolCallPart {
  type: "tool-call";
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  summary?: string;
}

export interface ImagePart {
  type: "image";
  mimeType: string;
  dataUrl?: string;
  name?: string;
}

export type MessagePart = TextPart | ToolCallPart | ImagePart;

export interface SessionMessageView {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt?: number;
  model?: string;
  stopped?: boolean;
  error?: string;
}

export interface SessionSummary {
  id: string;
  path: string;
  cwd: string;
  name: string;
  modifiedAt: number;
  messageCount: number;
  parentSessionPath?: string;
}

export interface ModelSummary {
  provider: string;
  id: string;
  label: string;
  configured: boolean;
  contextWindow?: number;
  reasoning: boolean;
}

export type ProviderCredentialSource =
  | "stored"
  | "runtime"
  | "environment"
  | "fallback"
  | "models_json_key"
  | "models_json_command";

export interface ProviderSummary {
  id: string;
  label: string;
  configured: boolean;
  credentialSource?: ProviderCredentialSource;
  credentialLabel?: string;
  modelCount: number;
}

export interface ResourceSummary {
  kind: "skill" | "prompt" | "extension" | "context";
  id: string;
  label: string;
  path?: string;
  status: "ready" | "partial" | "tui-only" | "failed";
  detail?: string;
}

export interface SessionSnapshot {
  sessionId: string;
  sessionPath?: string;
  sessionName?: string;
  cwd: string;
  streaming: boolean;
  messages: SessionMessageView[];
  models: ModelSummary[];
  providers: ProviderSummary[];
  selectedModel?: { provider: string; id: string };
  thinkingLevel: string;
  availableThinkingLevels: string[];
  steeringQueue: string[];
  followUpQueue: string[];
  tree: SessionTreeNodeView[];
  resources: ResourceSummary[];
  stats?: {
    tokens: number;
    cost: number;
    contextPercent?: number;
  };
}

export interface SessionTreeNodeView {
  id: string;
  parentId: string | null;
  type: string;
  label?: string;
  preview: string;
  active: boolean;
  children: SessionTreeNodeView[];
}

export type ExtensionUiKind =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "notify"
  | "status"
  | "widget"
  | "working"
  | "title"
  | "editor-text"
  | "unsupported";

export interface ExtensionUiRequestView {
  requestId: string;
  extensionId: string;
  kind: ExtensionUiKind;
  title?: string;
  message?: string;
  placeholder?: string;
  options?: string[];
  level?: "info" | "warning" | "error";
  key?: string;
  placement?: "aboveEditor" | "belowEditor";
  blocking: boolean;
}
