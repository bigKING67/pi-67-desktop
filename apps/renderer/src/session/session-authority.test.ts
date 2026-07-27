import type { SessionSnapshot } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptRendererSessionEvent,
  acceptRendererSessionResponse,
  acceptRendererSessionTransitionResponse,
  captureRendererSessionTransition,
  currentRendererSessionAuthority,
  type RendererSessionAuthorityState
} from "./session-authority.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import { installSessionProjectionFixture } from "./session-projection-test-support.js";

describe("renderer session authority", () => {
  beforeEach(() => {
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    installSessionProjectionFixture(state(), snapshot("session-1"), 3);
  });

  it("exposes one complete authority only while the projection is active", () => {
    expect(currentRendererSessionAuthority(state())).toEqual({
      hostEpoch: 9,
      sessionId: "session-1",
      sessionGeneration: 3,
      projectionRevision: 1
    });
    useSessionProjectionStore.getState().reset();
    expect(currentRendererSessionAuthority(state())).toBeUndefined();
    expect(currentRendererSessionAuthority(state({ connected: false }))).toBeUndefined();
  });

  it("invalidates all old response targets when a transaction advances the projection", () => {
    const current = state();
    const target = currentRendererSessionAuthority(current)!;
    useSessionProjectionStore.getState().reset();

    expect(useSessionProjectionStore.getState()).toMatchObject({
      authority: { phase: "inactive", projectionRevision: 2 }
    });
    expect(acceptRendererSessionResponse(current, target)).toBe(false);
  });

  it("rejects ordinary events until an authoritative bootstrap installs the generation", () => {
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    expect(installSessionProjectionFixture(
      state(),
      snapshot("session-2")
    )).toBeUndefined();
    const envelope = eventEnvelope("usage.changed", { tokens: 1, cost: 0 }, {
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-2",
      sessionGeneration: 7
    });
    expect(acceptRendererSessionEvent(state(), envelope)).toBeUndefined();
    expect(currentRendererSessionAuthority(state())).toBeUndefined();

    installSessionProjectionFixture(state(), snapshot("session-2"), 7);
    expect(acceptRendererSessionEvent(state(), envelope)).toEqual({
      hostEpoch: 9,
      sessionId: "session-2",
      sessionGeneration: 7,
      projectionRevision: 1
    });
  });

  it("rejects stale host, session, generation, and payload identities", () => {
    const current = state();
    const exact = eventEnvelope("usage.changed", { tokens: 1, cost: 0 }, {
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-1",
      sessionGeneration: 3
    });
    expect(acceptRendererSessionEvent(current, exact, "session-1")).toBeDefined();
    expect(acceptRendererSessionEvent(current, { ...exact, hostEpoch: 8 })).toBeUndefined();
    expect(acceptRendererSessionEvent(current, { ...exact, sessionId: "session-old" })).toBeUndefined();
    expect(acceptRendererSessionEvent(current, { ...exact, sessionGeneration: 2 })).toBeUndefined();
    expect(acceptRendererSessionEvent(current, exact, "session-old")).toBeUndefined();
  });

  it("guards session-changing responses with the transaction revision and Host epoch", () => {
    const current = state();
    const target = captureRendererSessionTransition(current)!;
    expect(acceptRendererSessionTransitionResponse(current, target)).toBe(true);
    useSessionProjectionStore.getState().reset();
    expect(acceptRendererSessionTransitionResponse(current, target)).toBe(false);
    expect(acceptRendererSessionTransitionResponse({ ...current, hostEpoch: 10 }, target)).toBe(false);
  });
});

function state(overrides: Partial<RendererSessionAuthorityState> = {}): RendererSessionAuthorityState {
  return { connected: true, hostEpoch: 9, ...overrides };
}

function snapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    cwd: "/workspace",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
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
