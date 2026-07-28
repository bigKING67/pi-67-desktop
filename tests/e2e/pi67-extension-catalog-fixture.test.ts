import {
  agentEventEnvelope,
  isEventEnvelope,
  isResponseEnvelope,
  responseEnvelope
} from "../../packages/protocol/src/index.js";
import { describe, expect, it } from "vitest";
import { MOCK_EXTENSION_CATALOG } from "./pi67-extension-catalog-fixture.js";

describe("renderer Extension Adapter fixtures", () => {
  it("remain valid protocol projections", () => {
    expect(isEventEnvelope(agentEventEnvelope(
      { type: "extension.catalog.changed", payload: MOCK_EXTENSION_CATALOG },
      {
        hostEpoch: 1,
        sequence: 1,
        context: {
          scope: "task",
          workspaceId: "workspace-test",
          taskId: "task-test",
          taskGeneration: 1,
          sessionId: "session-test",
          sessionGeneration: 1
        },
        taskSequence: 1
      }
    ))).toBe(true);
    expect(isResponseEnvelope(responseEnvelope(
      "request-1",
      1,
      {
        scope: "task",
        workspaceId: "workspace-test",
        taskId: "task-test",
        taskGeneration: 1,
        sessionId: "session-test",
        sessionGeneration: 1
      },
      { ok: true, type: "extension.catalog.list", result: MOCK_EXTENSION_CATALOG }
    ))).toBe(true);
  });
});
