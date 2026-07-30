import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import type { FixtureSessionSummary } from "./pi67-session-catalog-fixture.js";

export interface FixtureMessage {
  id: string;
  role: string;
  model?: string;
  parts: Array<{
    type: string;
    text?: string;
    mimeType?: string;
    id?: string;
    name?: string;
    status?: string;
    summary?: string;
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
  autoStartOperation?: boolean;
  rotateSessionOnCreate?: boolean;
  isolateTaskSnapshots?: boolean;
  providerConfigurationSnapshot?: PiProviderConfigurationSnapshot;
  sessionCatalogItems?: FixtureSessionSummary[];
  sessionCatalogItemsByWorkspace?: Record<string, FixtureSessionSummary[]>;
  assets?: Record<string, {
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    dataBase64: string;
    sessionGeneration?: number;
  }>;
}

interface MockEventOptions {
  hostEpoch?: number;
  operationId?: string;
  sequence?: number;
  taskSequence?: number;
  sessionId?: string;
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
  sessionCounter: number;
  operationCounter: number;
  conversationMessages: FixtureMessage[];
  workspaceChanges: { sessionId: string; items: unknown[]; truncated: boolean; total: number };
  extensionCatalog: { items: unknown[]; truncated: boolean; total: number };
  providerConfiguration: PiProviderConfigurationSnapshot;
  sessionCatalogPage: { itemCount: number };
  sessionCatalogPagesByWorkspace: Record<string, { itemCount: number }>;
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
  __pi67RotateMockSession(current: FixtureAgentState, sessionPath?: string): void;
};
