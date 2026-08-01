import type { ConversationPage, SessionSnapshot } from "@pi67/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_CONVERSATION_INDEX,
  selectCommittedConversationProjection,
  useConversationStore
} from "./conversation-store.js";
import type {
  SessionProjectionAuthority,
  SessionProjectionAuthorityState
} from "../session/session-projection-store.js";

const AUTHORITY = authority("session-a", 3, 1);

describe("conversation store", () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
  });

  it("drops a delayed older page after the Session authority changes", () => {
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 100, true), AUTHORITY);
    const target = useConversationStore.getState().currentTarget(active(AUTHORITY));
    expect(target).toBeDefined();
    expect(useConversationStore.getState().startOlder(target!, "session-a-0")).toBe(true);

    useConversationStore.getState().replaceSnapshot(
      snapshot("session-b", 2, false),
      authority("session-b", 4, 2)
    );

    expect(useConversationStore.getState().prependOlder(
      target!,
      "session-a-0",
      page("session-a", -100, 0, false)
    )).toBe(false);
    expect(useConversationStore.getState().messages.map((message) => message.id)).toEqual([
      "session-b-0",
      "session-b-1"
    ]);
  });

  it("prepends unique messages and preserves the Virtuoso anchor", () => {
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 3, true), AUTHORITY);
    const target = useConversationStore.getState().currentTarget(active(AUTHORITY))!;
    expect(useConversationStore.getState().startOlder(target, "session-a-0")).toBe(true);
    expect(useConversationStore.getState().prependOlder(
      target,
      "session-a-0",
      page("session-a", -2, 1, false)
    )).toBe(true);

    const state = useConversationStore.getState();
    expect(state.messages.map((message) => message.id)).toEqual([
      "session-a--2",
      "session-a--1",
      "session-a-0",
      "session-a-1",
      "session-a-2"
    ]);
    expect(state.firstItemIndex).toBe(INITIAL_CONVERSATION_INDEX - 2);
  });

  it("keeps loaded older messages when a settled recent page overlaps", () => {
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 5, true), AUTHORITY);
    const target = useConversationStore.getState().currentTarget(active(AUTHORITY))!;
    const recent = page("session-a", 3, 8, false);

    expect(useConversationStore.getState().replaceRecent(target, recent, {
      preserveOlder: true,
      settleStreaming: true
    })).toBe(true);
    expect(useConversationStore.getState().messages.map((message) => message.id)).toEqual([
      "session-a-0",
      "session-a-1",
      "session-a-2",
      "session-a-3",
      "session-a-4",
      "session-a-5",
      "session-a-6",
      "session-a-7"
    ]);
  });

  it("requires the exact Host, Session, generation, and canonical revision", () => {
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 1, false), AUTHORITY);

    expect(useConversationStore.getState().capture(AUTHORITY)).toMatchObject(AUTHORITY);
    for (const stale of [
      { ...AUTHORITY, hostEpoch: 8 },
      { ...AUTHORITY, sessionId: "session-b" },
      { ...AUTHORITY, sessionGeneration: 4 },
      { ...AUTHORITY, projectionRevision: 2 }
    ]) {
      expect(useConversationStore.getState().capture(stale)).toBeUndefined();
    }
  });

  it("hides staged messages until canonical authority commits and on every mismatch", () => {
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 2, false), AUTHORITY);
    const state = useConversationStore.getState();

    expect(selectCommittedConversationProjection(state, {
      phase: "inactive",
      projectionRevision: AUTHORITY.projectionRevision
    }).messages).toEqual([]);
    for (const stale of [
      { ...AUTHORITY, hostEpoch: 8 },
      { ...AUTHORITY, sessionId: "session-b" },
      { ...AUTHORITY, sessionGeneration: 4 },
      { ...AUTHORITY, projectionRevision: 2 }
    ]) {
      expect(selectCommittedConversationProjection(state, active(stale)).messages).toEqual([]);
    }
    expect(selectCommittedConversationProjection(state, active(AUTHORITY)).messages).toHaveLength(2);
  });

  it("invalidates pending page targets without discarding settled messages", () => {
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 2, true), AUTHORITY);
    const target = useConversationStore.getState().currentTarget(active(AUTHORITY))!;
    expect(useConversationStore.getState().startOlder(target, "session-a-0")).toBe(true);

    useConversationStore.getState().invalidateProjection();

    expect(useConversationStore.getState()).toMatchObject({
      loadingOlder: false,
      streaming: false,
      error: undefined
    });
    expect(useConversationStore.getState().messages).toHaveLength(2);
    expect(useConversationStore.getState().prependOlder(
      target,
      "session-a-0",
      page("session-a", -1, 0, false)
    )).toBe(false);
  });

  it("shows an accepted user Turn only under its exact Conversation authority", () => {
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 0, false), AUTHORITY);
    const pending = pendingUserTurn("operation-a", AUTHORITY);

    expect(useConversationStore.getState().installPendingUserTurn(pending)).toBe(true);
    expect(selectCommittedConversationProjection(
      useConversationStore.getState(),
      active(AUTHORITY)
    ).pendingUserTurn).toMatchObject({
      operationId: "operation-a",
      status: "accepted",
      message: { id: "pending-user:operation-a", role: "user" }
    });
    expect(useConversationStore.getState().installPendingUserTurn({
      ...pending,
      operationId: "operation-stale",
      authority: { ...AUTHORITY, sessionGeneration: AUTHORITY.sessionGeneration + 1 }
    })).toBe(false);
  });

  it("reconciles a pending user Turn only when its Operation projects a new user message", () => {
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 1, false), AUTHORITY);
    useConversationStore.getState().setStreaming(true, AUTHORITY);
    expect(useConversationStore.getState().installPendingUserTurn(
      pendingUserTurn("operation-a", AUTHORITY)
    )).toBe(true);
    const target = useConversationStore.getState().currentTarget(active(AUTHORITY))!;

    expect(useConversationStore.getState().replaceRecent(
      target,
      page("session-a", 0, 2, false),
      { preserveOlder: true, settleStreaming: false, operationId: "operation-a" }
    )).toBe(true);
    expect(useConversationStore.getState().pendingUserTurn).toBeDefined();
    expect(useConversationStore.getState().streaming).toBe(true);

    const authoritativeUser = {
      id: "session-a-user-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Run the task" }]
    };
    expect(useConversationStore.getState().replaceRecent(
      target,
      {
        sessionId: "session-a",
        messages: [message("session-a", 0), authoritativeUser],
        startCursor: "session-a-0",
        endCursor: authoritativeUser.id,
        hasOlder: false,
        hasNewer: false
      },
      { preserveOlder: true, settleStreaming: false, operationId: "operation-a" }
    )).toBe(true);
    expect(useConversationStore.getState().pendingUserTurn).toBeUndefined();
    expect(useConversationStore.getState().streaming).toBe(true);
    expect(useConversationStore.getState().messages.filter((item) => item.role === "user"))
      .toEqual([authoritativeUser]);
  });

  it("keeps an uncommitted Prompt visible on terminal failure", () => {
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 0, false), AUTHORITY);
    useConversationStore.getState().installPendingUserTurn(pendingUserTurn("operation-a", AUTHORITY));

    expect(useConversationStore.getState().markPendingUserTurnFailed(
      "operation-a",
      "Pi runtime stopped"
    )).toBe(true);
    expect(useConversationStore.getState().pendingUserTurn).toMatchObject({
      status: "failed",
      message: { error: "发送失败：Pi runtime stopped" }
    });
    expect(useConversationStore.getState().markPendingUserTurnFailed(
      "operation-other",
      "stale"
    )).toBe(false);
  });

  it("releases pending attachment previews when authority is replaced", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    useConversationStore.getState().replaceSnapshot(snapshot("session-a", 0, false), AUTHORITY);
    useConversationStore.getState().installPendingUserTurn({
      ...pendingUserTurn("operation-a", AUTHORITY),
      attachments: [{
        id: "attachment-a",
        name: "prompt.png",
        mimeType: "image/png",
        byteLength: 5,
        kind: "image",
        previewUrl: "blob:prompt-a"
      }]
    });

    useConversationStore.getState().replaceSnapshot(
      snapshot("session-b", 0, false),
      authority("session-b", 4, 2)
    );

    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:prompt-a");
    expect(useConversationStore.getState().pendingUserTurn).toBeUndefined();
  });
});

function authority(
  sessionId: string,
  sessionGeneration: number,
  projectionRevision: number
): SessionProjectionAuthority {
  return { hostEpoch: 7, sessionId, sessionGeneration, projectionRevision };
}

function active(authorityValue: SessionProjectionAuthority): SessionProjectionAuthorityState {
  return { phase: "active", ...authorityValue };
}

function snapshot(sessionId: string, count: number, hasOlder: boolean): SessionSnapshot {
  const messages = Array.from({ length: count }, (_, index) => message(sessionId, index));
  return {
    sessionId,
    cwd: "/workspace",
    streaming: false,
    messages,
    messagePage: {
      ...(messages[0] ? { startCursor: messages[0].id } : {}),
      ...(messages.at(-1) ? { endCursor: messages.at(-1)!.id } : {}),
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

function pendingUserTurn(operationId: string, authorityValue: SessionProjectionAuthority) {
  return {
    submissionId: `submission:${operationId}`,
    operationId,
    authority: authorityValue,
    message: {
      id: `pending-user:${operationId}`,
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Run the task" }]
    },
    attachments: [],
    status: "accepted" as const
  };
}
