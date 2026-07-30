import type { ConversationPage, OperationView, SessionSnapshot } from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionProjectionStore, type FeatureProjectionAuthority } from "../session/session-projection-store.js";
import {
  loadOlderConversation,
  refreshConversation,
  resetConversationRequests
} from "./conversation-controller.js";
import { useConversationStore } from "./conversation-store.js";

const AUTHORITY: FeatureProjectionAuthority = {
  hostEpoch: 7,
  sessionId: "session-a",
  sessionGeneration: 3,
  projectionRevision: 1
};

describe("conversation controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetConversationRequests();
    useConversationStore.setState(useConversationStore.getInitialState(), true);
    useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    installConversation("session-a", AUTHORITY, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConversationRequests();
  });

  it("drops a delayed older page after canonical Session authority changes", async () => {
    const pending = deferred<ConversationPage>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(pending.promise as never);

    const loading = loadOlderConversation();
    const nextAuthority: FeatureProjectionAuthority = {
      ...AUTHORITY,
      sessionId: "session-b",
      sessionGeneration: 4,
      projectionRevision: 2
    };
    installConversation("session-b", nextAuthority, false);
    pending.resolve(page("session-a", -1, 0, false));
    await loading;

    expect(useConversationStore.getState().messages.map((message) => message.id)).toEqual([
      "session-b-0",
      "session-b-1"
    ]);
    expect(useConversationStore.getState()).toMatchObject({ loadingOlder: false, error: undefined });
  });

  it("surfaces only the current older-page failure", async () => {
    const request = vi.spyOn(agentConnectionController, "request")
      .mockRejectedValueOnce(new Error("fixture failure"));
    await loadOlderConversation();
    expect(useConversationStore.getState()).toMatchObject({
      loadingOlder: false,
      error: "无法加载更早消息：fixture failure"
    });

    const pending = deferred<ConversationPage>();
    request.mockReturnValueOnce(pending.promise as never);
    const loading = loadOlderConversation();
    resetConversationRequests();
    useConversationStore.getState().invalidateProjection();
    pending.reject(new Error("stale failure"));
    await loading;
    expect(useConversationStore.getState().error).toBeUndefined();
  });

  it("settles live text only after the current recent page is installed", async () => {
    useLiveTurnStore.getState().begin(operation(), AUTHORITY.hostEpoch);
    useLiveTurnStore.getState().append({ text: "live result", thinking: "private" }, {
      hostEpoch: AUTHORITY.hostEpoch,
      sessionId: AUTHORITY.sessionId,
      sessionGeneration: AUTHORITY.sessionGeneration,
      operationId: "operation-a"
    });
    const pending = deferred<ConversationPage>();
    const request = vi.spyOn(agentConnectionController, "request")
      .mockReturnValue(pending.promise as never);

    refreshConversation(settledEvent("session-a"), AUTHORITY, "operation-a");
    expect(useLiveTurnStore.getState().textChunks.join("")).toBe("live result");
    pending.resolve(page("session-a", 0, 3, false));
    await vi.waitFor(() => expect(useLiveTurnStore.getState().textChunks).toEqual([]));

    useLiveTurnStore.getState().begin(operation("operation-b"), AUTHORITY.hostEpoch);
    useLiveTurnStore.getState().append({ text: "new live result", thinking: "" }, {
      hostEpoch: AUTHORITY.hostEpoch,
      sessionId: AUTHORITY.sessionId,
      sessionGeneration: AUTHORITY.sessionGeneration,
      operationId: "operation-b"
    });
    const stale = deferred<ConversationPage>();
    request.mockReturnValueOnce(stale.promise as never);
    refreshConversation(settledEvent("session-a"), AUTHORITY, "operation-b");
    resetConversationRequests();
    stale.resolve(page("session-a", 0, 4, false));
    await Promise.resolve();
    expect(useLiveTurnStore.getState().textChunks.join("")).toBe("new live result");
  });
});

function installConversation(
  sessionId: string,
  authority: FeatureProjectionAuthority,
  hasOlder: boolean
): void {
  useSessionProjectionStore.setState({ authority: { phase: "active", ...authority } });
  useConversationStore.getState().replaceSnapshot(snapshot(sessionId, hasOlder), authority);
}

function snapshot(sessionId: string, hasOlder: boolean): SessionSnapshot {
  const messages = [message(sessionId, 0), message(sessionId, 1)];
  return {
    sessionId,
    cwd: "/workspace",
    streaming: false,
    messages,
    messagePage: {
      startCursor: messages[0]!.id,
      endCursor: messages[1]!.id,
      hasOlder,
      hasNewer: false
    },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}

function page(sessionId: string, start: number, end: number, hasOlder: boolean): ConversationPage {
  const messages = Array.from({ length: end - start }, (_, index) => message(sessionId, start + index));
  return {
    sessionId,
    messages,
    ...(messages[0] ? { startCursor: messages[0].id } : {}),
    ...(messages.at(-1) ? { endCursor: messages.at(-1)!.id } : {}),
    hasOlder,
    hasNewer: false
  };
}

function message(sessionId: string, index: number) {
  return {
    id: `${sessionId}-${index}`,
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: `message ${index}` }]
  };
}

function operation(operationId = "operation-a"): OperationView {
  return {
    operationId,
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: AUTHORITY.sessionId,
    sessionGeneration: AUTHORITY.sessionGeneration,
    startedAt: 1
  };
}

function settledEvent(sessionId: string): Extract<AgentEvent, { type: "conversation.changed" }> {
  return { type: "conversation.changed", payload: { sessionId, reason: "settled" } };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
