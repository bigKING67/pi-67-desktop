import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import type { ProviderSummary } from "../../packages/domain/src/index.js";
import type {
  ContextFileCatalogResult,
  ExtensionCatalogResult
} from "../../packages/domain/src/index.js";
import type { FixtureSessionSummary } from "./pi67-session-catalog-fixture.js";

export interface FixtureMessage {
  id: string;
  role: string;
  createdAt?: number;
  model?: string;
  toolName?: string;
  stopped?: boolean;
  error?: string;
  parts: Array<{
    type: string;
    text?: string;
    mimeType?: string;
    byteLength?: number;
    kind?: string;
    id?: string;
    name?: string;
    status?: string;
    summary?: string;
    plan?: {
      entryId: string;
      planId: string;
      sourceOperationId: string;
      markdown: string;
      createdAt: number;
      status: "proposed" | "implemented" | "dismissed";
    };
    asset?: {
      id: string;
      byteLength: number;
      sessionGeneration: number;
    };
    adapter?: {
      adapterId: string;
      package: string;
      presentation: "generic" | "command" | "read" | "change";
      label?: string;
    };
  }>;
}

export interface MockAgentOptions {
  hostEpoch?: number;
  terminalDelayMs?: number;
  planImplementationStartDelayMs?: number;
  autoStartOperation?: boolean;
  rotateSessionOnCreate?: boolean;
  isolateTaskSnapshots?: boolean;
  providerCatalogProviders?: ProviderSummary[];
  providerConfigurationSnapshot?: PiProviderConfigurationSnapshot;
  extensionCatalog?: ExtensionCatalogResult;
  contextFiles?: FixtureContextFiles;
  sessionCatalogItems?: FixtureSessionSummary[];
  sessionCatalogItemsByWorkspace?: Record<string, FixtureSessionSummary[]>;
  sessionMessagesByPath?: Record<string, FixtureMessage[]>;
  responseResults?: Record<string, unknown>;
  assets?: Record<string, {
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    dataBase64: string;
    sessionGeneration?: number;
  }>;
}

export interface FixtureContextFiles {
  catalog: ContextFileCatalogResult;
  contents: Record<string, { content: string; revision: string }>;
}

export interface MockEventOptions {
  context?: "app" | "workspace" | "task";
  hostEpoch?: number;
  operationId?: string;
  sequence?: number;
  taskSequence?: number;
  sessionId?: string;
  sessionFileIdentity?: string;
  sessionGeneration?: number;
}

export type TestPort = MessagePort & { start(): void };
export type FixtureFailure = { code: string; message: string; recoverable: boolean };
type FixtureCommand = {
  type: string;
  payload: unknown;
  hostEpoch: number;
  context: Record<string, unknown>;
};
type FixtureOperationKind = "prompt" | "command" | "compaction" | "session-import";

interface FixtureOperationView {
  operationId: string;
  kind: FixtureOperationKind;
  lifecycle: "submitting" | "accepted" | "running" | "waiting-input" | "completed" | "failed" | "cancelled" | "lost";
  cancellable: boolean;
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
  startedAt: number;
}

interface FixtureOperationSettledBase {
  kind: "settled";
  operationId: string;
  operationKind: FixtureOperationKind;
  cancellable: false;
  hostEpoch: number;
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
  startedAt: number;
  settledAt: number;
}

type FixtureOperationSettled = FixtureOperationSettledBase & (
  | { lifecycle: "completed" }
  | { lifecycle: "failed"; error: FixtureFailure }
  | { lifecycle: "cancelled" | "lost"; reason: string }
);

export interface FixtureResyncOperations {
  activeOperation?: FixtureOperationView;
  latestOperationTerminal?: FixtureOperationSettled;
}

interface FixtureTaskState {
  taskSequence: number;
  sessionGeneration: number;
  taskToolMode: "ask" | "auto" | "yolo";
  conversationMessages: FixtureMessage[];
  workspaceChanges: { sessionId: string; items: unknown[]; truncated: boolean; total: number };
  snapshot: Record<string, unknown>;
}

export interface FixtureAgentState {
  activePort?: TestPort;
  appInstanceId: string;
  ready: boolean;
  hostEpoch: number;
  sequence: number;
  taskSequence: number;
  workspaceId: string;
  taskId: string;
  taskGeneration: number;
  sessionGeneration: number;
  taskToolMode: "ask" | "auto" | "yolo";
  sessionCounter: number;
  operationCounter: number;
  conversationMessages: FixtureMessage[];
  workspaceChanges: { sessionId: string; items: unknown[]; truncated: boolean; total: number };
  extensionCatalog: { items: unknown[]; truncated: boolean; total: number };
  contextFiles: FixtureContextFiles;
  providerConfiguration: PiProviderConfigurationSnapshot;
  sessionCatalogPage: { itemCount: number; revision: number };
  sessionCatalogPagesByWorkspace: Record<string, { itemCount: number; revision: number }>;
  assets: Record<string, { mimeType: string; dataBase64: string; sessionGeneration?: number }>;
  snapshot: Record<string, unknown>;
  responseDelays: Record<string, number>;
  responseFailures: Record<string, FixtureFailure>;
  responseResults: Record<string, unknown>;
  commands: FixtureCommand[];
  taskStates: Record<string, FixtureTaskState>;
  resyncOperations: FixtureResyncOperations;
  terminalDelayMs?: number;
  autoStartOperation: boolean;
  attachHost(hostEpoch: number): void;
  emit(event: { type: string; payload: unknown }, options?: MockEventOptions): void;
}

export type FixtureWindow = Window & typeof globalThis & {
  __pi67TestAgent?: FixtureAgentState;
  __pi67RotateMockSession(
    current: FixtureAgentState,
    sessionPath?: string,
    messages?: FixtureMessage[],
    sessionFileIdentity?: string
  ): void;
  __pi67ForkMockSession(current: FixtureAgentState, entryId: unknown, position: unknown): void;
};
