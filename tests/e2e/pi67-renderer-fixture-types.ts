import type { FixtureSessionSummary } from "./pi67-session-catalog-fixture.js";

export interface FixtureMessage {
  id: string;
  role: string;
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
  sessionCatalogItems?: FixtureSessionSummary[];
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
  sessionId?: string;
  sessionGeneration?: number;
}

export type TestPort = MessagePort & { start(): void };
export type FixtureFailure = { code: string; message: string; recoverable: boolean };
type FixtureCommand = { type: string; payload: unknown; hostEpoch: number };
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

export interface FixtureAgentState {
  activePort?: TestPort;
  appInstanceId: string;
  hostEpoch: number;
  sequence: number;
  sessionGeneration: number;
  operationCounter: number;
  conversationMessages: FixtureMessage[];
  workspaceChanges: { sessionId: string; items: unknown[]; truncated: boolean; total: number };
  extensionCatalog: { items: unknown[]; truncated: boolean; total: number };
  sessionCatalogPage: { itemCount: number };
  assets: Record<string, { mimeType: string; dataBase64: string; sessionGeneration?: number }>;
  snapshot: Record<string, unknown>;
  responseDelays: Record<string, number>;
  responseFailures: Record<string, FixtureFailure>;
  responseResults: Record<string, unknown>;
  commands: FixtureCommand[];
  resyncOperations: FixtureResyncOperations;
  terminalDelayMs?: number;
  autoStartOperation: boolean;
  attachHost(hostEpoch: number): void;
  emit(event: { type: string; payload: unknown }, options?: MockEventOptions): void;
}

export type FixtureWindow = Window & typeof globalThis & { __pi67TestAgent?: FixtureAgentState };
