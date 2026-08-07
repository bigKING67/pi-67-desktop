import type { SessionSnapshot, WorkspaceChangesProjection } from "@pi67/domain";
import {
  eventEnvelope,
  type CommandResults,
  type ProjectionResyncResult
} from "@pi67/protocol";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { resetModelSelection } from "../session/model-selection-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useAppStore } from "./app-store.js";

export function installSession(sessionId: string, sessionGeneration: number): void {
  const value = snapshot(sessionId);
  useAppStore.setState({
    connected: true,
    hostEpoch: 9,
    workspace: "/workspace",
    trust: "unknown",
    trustUpdating: false,
    sessionTransitionPending: false,
    runtime: { phase: "ready", detail: "Ready", recoverable: true }
  });
  const authority = installSessionProjectionFixture(
    useAppStore.getState(),
    value,
    sessionGeneration
  );
  if (!authority) throw new Error("Expected Session projection fixture authority.");
  useConversationStore.getState().replaceSnapshot(value, authority);
  useSessionTreeStore.getState().replaceProjection(authority, value.tree);
}

export function emitQueue(steeringQueue: string[], followUpQueue: string[]): void {
  const payload = { steeringQueue, followUpQueue };
  useAppStore.getState().receiveAgentEvent(
    { type: "queue.changed", payload },
    eventEnvelope("queue.changed", payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-1",
      sessionGeneration: 3
    }))
  );
}

export function emitUsage(tokens: number, cost: number, contextPercent: number): void {
  const payload = { tokens, cost, contextPercent };
  useAppStore.getState().receiveAgentEvent(
    { type: "usage.changed", payload },
    eventEnvelope("usage.changed", payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-1",
      sessionGeneration: 3
    }))
  );
}

export function emitMeta(
  sessionName: string,
  selectedModel: NonNullable<SessionSnapshot["selectedModel"]>,
  thinkingLevel: string
): void {
  const payload = { sessionName, selectedModel, thinkingLevel, streaming: false };
  useAppStore.getState().receiveAgentEvent(
    { type: "session.metaChanged", payload },
    eventEnvelope("session.metaChanged", payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 3,
      sessionId: "session-1",
      sessionGeneration: 3
    }))
  );
}

export function resourceCatalogResult(
  sessionId: string,
  overrides: Partial<CommandResults["workspace.setTrust"]> = {}
): CommandResults["workspace.setTrust"] {
  return {
    sessionId,
    controls: {
      selectedModel: { provider: "openai", id: "gpt" },
      thinkingLevel: "high"
    },
    modelCatalog: {
      models: [{ provider: "openai", id: "gpt", label: "GPT", configured: true, reasoning: true }],
      providers: [{ id: "openai", label: "OpenAI", configured: true, modelCount: 1 }],
      availableThinkingLevels: ["off", "high"]
    },
    resources: [],
    ...overrides
  };
}

export function modelSelectionResult(
  sessionId: string,
  selectedModel: NonNullable<SessionSnapshot["selectedModel"]>,
  thinkingLevel = "high",
  availableThinkingLevels: string[] = ["off", "high"]
): CommandResults["model.select"] {
  return {
    sessionId,
    controls: { selectedModel, thinkingLevel },
    modelCatalog: {
      models: [
        { provider: "openai", id: "gpt", label: "GPT", configured: true, reasoning: true },
        { provider: "anthropic", id: "claude", label: "Claude", configured: true, reasoning: true },
        {
          provider: "deepseek",
          id: "deepseek-v4-flash",
          label: "DeepSeek V4 Flash",
          configured: true,
          reasoning: true
        }
      ],
      providers: [
        { id: "openai", label: "OpenAI", configured: true, modelCount: 1 },
        { id: "anthropic", label: "Anthropic", configured: true, modelCount: 1 },
        { id: "deepseek", label: "DeepSeek", configured: true, modelCount: 1 }
      ],
      availableThinkingLevels
    }
  };
}

export function resyncResult(
  selectedModel: NonNullable<SessionSnapshot["selectedModel"]>
): ProjectionResyncResult {
  return {
    snapshot: snapshot("session-1", { selectedModel }),
    changes: emptyChanges(),
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: {
      revision: 1,
      itemCount: 1,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      incomplete: false,
      skippedCount: 0
    },
    eventSequence: 3,
    hostEpoch: 9,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-session-1",
    sessionGeneration: 3,
    taskToolMode: "auto"
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => { resolve = done; }),
    resolve
  };
}

export function resetStores(): void {
  resetModelSelection();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  useConversationStore.setState(useConversationStore.getInitialState(), true);
  useSessionTreeStore.setState(useSessionTreeStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
}

function snapshot(sessionId: string, overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId,
    sessionFileIdentity: `session-file-${sessionId}`,
    sessionPath: `/sessions/${sessionId}.jsonl`,
    sessionName: sessionId,
    cwd: "/workspace",
    streaming: false,
    messages: [{ id: "message-1", role: "assistant", parts: [{ type: "text", text: "ready" }] }],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [{ provider: "openai", id: "gpt", label: "GPT", configured: true, reasoning: true }],
    providers: [{ id: "openai", label: "OpenAI", configured: true, modelCount: 1 }],
    selectedModel: { provider: "openai", id: "gpt" },
    thinkingLevel: "high",
    availableThinkingLevels: ["off", "high"],
    steeringQueue: [],
    followUpQueue: [],
    tree: {
      nodes: [{
        id: "entry-1",
        parentId: null,
        type: "message",
        preview: "ready",
        active: true,
        depth: 0
      }],
      truncated: false,
      total: 1
    },
    resources: [],
    stats: { tokens: 10, cost: 0.1, contextPercent: 5 },
    ...overrides
  };
}

function emptyChanges(): WorkspaceChangesProjection {
  return { sessionId: "session-1", items: [], truncated: false, total: 0 };
}
