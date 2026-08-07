import type { SessionSnapshot, WorkspaceChangesProjection } from "@pi67/domain";
import type {
  OperationSettled,
  ProjectionResyncResult
} from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import { assertProjectionResyncAuthority } from "./projection-resync-installation.js";

describe("projection resync physical Session authority", () => {
  it("accepts one internally consistent physical Session projection", () => {
    expect(() => assertProjectionResyncAuthority(result())).not.toThrow();
  });

  it("rejects an outer authority that does not match the snapshot", () => {
    expect(() => assertProjectionResyncAuthority({
      ...result(),
      sessionFileIdentity: "session-file-other"
    })).toThrow("mismatched physical Session authority");
  });

  it("rejects an active Operation from another physical Session", () => {
    expect(() => assertProjectionResyncAuthority({
      ...result(),
      activeOperation: {
        ...operation(),
        sessionFileIdentity: "session-file-other"
      }
    })).toThrow("active Operation for a different physical Session");
  });

  it("rejects a terminal receipt from another physical Session", () => {
    expect(() => assertProjectionResyncAuthority({
      ...result(),
      latestOperationTerminal: {
        ...terminal(),
        sessionFileIdentity: "session-file-other"
      }
    })).toThrow("Operation receipt for a different physical Session");
  });
});

function result(): ProjectionResyncResult {
  return {
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    snapshot: snapshot(),
    changes: changes(),
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
    eventSequence: 4,
    hostEpoch: 7,
    sessionGeneration: 3,
    taskToolMode: "auto",
    activeOperation: operation(),
    latestOperationTerminal: terminal()
  };
}

function snapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
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

function changes(): WorkspaceChangesProjection {
  return {
    sessionId: "session-1",
    items: [],
    truncated: false,
    total: 0
  };
}

function operation() {
  return {
    operationId: "operation-active",
    kind: "prompt" as const,
    lifecycle: "running" as const,
    cancellable: true,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionGeneration: 3,
    startedAt: 1
  };
}

function terminal(): OperationSettled {
  return {
    kind: "settled",
    operationId: "operation-terminal",
    operationKind: "prompt",
    lifecycle: "completed",
    cancellable: false,
    hostEpoch: 7,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionGeneration: 3,
    startedAt: 1,
    settledAt: 2
  };
}
