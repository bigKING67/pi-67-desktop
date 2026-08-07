import type { SessionSnapshot } from "@pi67/domain";
import type { OperationAccepted, OperationSettled } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  captureSessionImportSubmission,
  classifySessionImportResponse,
  isSessionImportSubmissionCurrent
} from "./session-import-transition.js";

describe("session import response authority", () => {
  beforeEach(() => {
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  });

  it("accepts only an acknowledgement bound to the captured Session authority", () => {
    const state = connection();
    installSessionProjectionFixture(state, snapshot("session-old"), 3);
    const target = captureSessionImportSubmission(state)!;

    expect(classifySessionImportResponse(state, target, accepted())).toBe("accepted");
    expect(classifySessionImportResponse(state, target, {
      ...accepted(),
      sessionGeneration: 4
    })).toBe("stale");
  });

  it("requires bootstrap authority instead of treating a completed replay receipt as ready", () => {
    const state = connection();
    installSessionProjectionFixture(state, snapshot("session-old"), 3);
    const target = captureSessionImportSubmission(state)!;

    expect(classifySessionImportResponse(state, target, completed())).toBe("bootstrap-required");
  });

  it("drops a response after authoritative bootstrap advances the projection revision", () => {
    const state = connection();
    installSessionProjectionFixture(state, snapshot("session-old"), 3);
    const target = captureSessionImportSubmission(state)!;
    installSessionProjectionFixture(state, snapshot("session-imported"), 7);

    expect(isSessionImportSubmissionCurrent(state, target)).toBe(false);
    expect(classifySessionImportResponse(state, target, completed())).toBe("stale");
  });

  it("accepts a terminal failure only while it still belongs to the source authority", () => {
    const state = connection();
    installSessionProjectionFixture(state, snapshot("session-old"), 3);
    const target = captureSessionImportSubmission(state)!;

    expect(classifySessionImportResponse(state, target, failed())).toBe("terminal");
    expect(classifySessionImportResponse(state, target, {
      ...failed(),
      sessionId: "session-imported",
      sessionGeneration: 7
    })).toBe("bootstrap-required");
  });
});

function connection() {
  return { connected: true, hostEpoch: 9 };
}

function accepted(): OperationAccepted {
  return {
    kind: "accepted",
    operationId: "operation-import",
    cancellable: false,
    hostEpoch: 9,
    sessionId: "session-old",
    sessionFileIdentity: "session-file-session-old",
    sessionGeneration: 3
  };
}

function completed(): OperationSettled {
  return {
    kind: "settled",
    operationId: "operation-import",
    operationKind: "session-import",
    lifecycle: "completed",
    cancellable: false,
    hostEpoch: 9,
    sessionId: "session-imported",
    sessionFileIdentity: "session-file-session-imported",
    sessionGeneration: 7,
    startedAt: 1,
    settledAt: 2
  };
}

function failed(): OperationSettled {
  return {
    kind: "settled",
    operationId: "operation-import",
    operationKind: "session-import",
    lifecycle: "failed",
    cancellable: false,
    hostEpoch: 9,
    sessionId: "session-old",
    sessionFileIdentity: "session-file-session-old",
    sessionGeneration: 3,
    startedAt: 1,
    settledAt: 2,
    error: { code: "INTERNAL", message: "Import failed", recoverable: true }
  };
}

function snapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    sessionFileIdentity: `session-file-${sessionId}`,
    sessionPath: `/sessions/${sessionId}.jsonl`,
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
