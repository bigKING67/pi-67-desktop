import type { SessionSnapshot } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import {
  capturePromptSubmissionAuthority,
  validatePromptSubmissionAcceptance
} from "./prompt-submission-authority.js";

const expected = {
  hostEpoch: 4,
  sessionId: "session-a",
  sessionGeneration: 7,
  projectionRevision: 1
};

const accepted = {
  kind: "accepted" as const,
  operationId: "operation-1",
  cancellable: true,
  hostEpoch: 4,
  sessionId: "session-a",
  sessionGeneration: 7
};

describe("prompt submission authority", () => {
  beforeEach(() => installSession(7));

  it("requires a complete Host and Session authority before submission", () => {
    installSession();
    expect(capturePromptSubmissionAuthority(connection())).toBeUndefined();
    installSession(7);
    expect(capturePromptSubmissionAuthority(connection())).toEqual(expected);
  });

  it("rejects an acceptance from a replaced Host", () => {
    expect(validatePromptSubmissionAcceptance(expected, {
      ...accepted,
      hostEpoch: 5
    }, connection())).toBe("STALE_HOST_EPOCH");
  });

  it("rejects an acceptance after either the response or current Session changes", () => {
    expect(validatePromptSubmissionAcceptance(expected, {
      ...accepted,
      sessionId: "session-b"
    }, connection())).toBe("STALE_SESSION_GENERATION");
    installSessionProjectionFixture(connection(), snapshot(), 8);
    expect(validatePromptSubmissionAcceptance(expected, accepted, connection()))
      .toBe("STALE_SESSION_GENERATION");
  });

  it("rejects an acknowledgement captured before a projection transaction", () => {
    installSessionProjectionFixture(connection(), snapshot(), 7);
    expect(validatePromptSubmissionAcceptance(expected, accepted, connection()))
      .toBe("STALE_PROJECTION");
  });

  it("accepts only an acknowledgement that still matches the captured authority", () => {
    expect(validatePromptSubmissionAcceptance(expected, accepted, connection())).toBeUndefined();
  });
});

function installSession(sessionGeneration?: number): void {
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  installSessionProjectionFixture(
    connection(),
    snapshot(),
    sessionGeneration
  );
}

function connection() {
  return { connected: true, hostEpoch: 4 };
}

function snapshot(): SessionSnapshot {
  return {
    sessionId: "session-a",
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
