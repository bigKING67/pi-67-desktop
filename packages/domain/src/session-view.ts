import type { ExtensionToolAdapterView } from "./extension-compatibility.js";
import type { ExtensionCompatibility } from "./runtime-state.js";
import type { AssetReference } from "./asset.js";

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
  adapter?: ExtensionToolAdapterView;
}

export interface ImagePart {
  type: "image";
  mimeType: string;
  asset?: AssetReference;
  name?: string;
}

export type AttachmentKind = "document" | "archive" | "audio" | "video" | "file";

export interface AttachmentPart {
  type: "attachment";
  id: string;
  name: string;
  mimeType: string;
  byteLength: number;
  kind: AttachmentKind;
}

export type MessagePart = TextPart | ToolCallPart | ImagePart | AttachmentPart;

export interface SessionMessageView {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt?: number;
  model?: string;
  toolName?: string;
  stopped?: boolean;
  error?: string;
}

export interface SessionSummary {
  fileIdentity: string;
  id: string;
  path: string;
  cwd: string;
  name: string;
  nameSource: "explicit" | "latest-user" | "fallback";
  modifiedAt: number;
  messageCount: number;
  pinnedAt?: number;
  archivedAt?: number;
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
  source?: string;
  scope?: "user" | "project" | "temporary";
  origin?: "package" | "top-level";
  status: "ready" | "partial" | "tui-only" | "failed";
  detail?: string;
}

export interface SessionControlsView {
  selectedModel?: { provider: string; id: string };
  thinkingLevel: string;
}

export interface SessionModelCatalogView {
  models: ModelSummary[];
  providers: ProviderSummary[];
  availableThinkingLevels: string[];
}

export interface SessionControlResult {
  sessionId: string;
  controls: SessionControlsView;
}

export interface SessionModelCatalogResult extends SessionControlResult {
  modelCatalog: SessionModelCatalogView;
}

export interface SessionResourceCatalogResult extends SessionModelCatalogResult {
  resources: ResourceSummary[];
}

export interface SessionSnapshot {
  sessionId: string;
  sessionFileIdentity?: string;
  sessionPath?: string;
  sessionName?: string;
  cwd: string;
  streaming: boolean;
  messages: SessionMessageView[];
  messagePage: MessagePageMetadata;
  models: SessionModelCatalogView["models"];
  providers: SessionModelCatalogView["providers"];
  selectedModel?: SessionControlsView["selectedModel"];
  thinkingLevel: SessionControlsView["thinkingLevel"];
  availableThinkingLevels: SessionModelCatalogView["availableThinkingLevels"];
  steeringQueue: string[];
  followUpQueue: string[];
  tree: SessionTreeProjection;
  resources: ResourceSummary[];
  stats?: {
    tokens: number;
    cost: number;
    contextPercent?: number;
  };
}

export interface MessagePageMetadata {
  startCursor?: string;
  endCursor?: string;
  hasOlder: boolean;
  hasNewer: boolean;
}

export interface ConversationPage extends MessagePageMetadata {
  sessionId: string;
  messages: SessionMessageView[];
}

export interface SessionTreeNodeView {
  id: string;
  parentId: string | null;
  type: string;
  label?: string;
  preview: string;
  active: boolean;
  depth: number;
}

export interface SessionTreeProjection {
  nodes: SessionTreeNodeView[];
  truncated: boolean;
  total: number;
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
  extensionId?: string;
  extensionPackage?: string;
  extensionPath?: string;
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
  hostEpoch?: number;
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

export interface ExtensionCompatibilityEventView {
  extensionId?: string;
  extensionPackage?: string;
  extensionPath?: string;
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
  hostEpoch?: number;
  status: ExtensionCompatibility;
  detail: string;
}

export type ExtensionUiCancellationReason =
  | "session-transition"
  | "resource-reload"
  | "runtime-dispose"
  | "connection-close"
  | "projection-resync"
  | "timeout"
  | "abort";
