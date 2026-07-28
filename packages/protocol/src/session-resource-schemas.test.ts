import type { SessionSnapshot } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { isResponseEnvelope, responseEnvelope, type ProtocolContext } from "./envelope.js";

const TASK_CONTEXT: ProtocolContext = {
  scope: "task",
  workspaceId: "workspace-1",
  taskId: "task-1",
  taskGeneration: 1,
  sessionId: "session-1",
  sessionGeneration: 1
};

describe("Session resource response schemas", () => {
  it("accepts narrow resource catalogs and rejects legacy full snapshots", () => {
    const result = {
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "openai", id: "gpt-5.6" },
        thinkingLevel: "high"
      },
      modelCatalog: {
        models: [],
        providers: [],
        availableThinkingLevels: ["off", "high"]
      },
      resources: []
    };
    const trust = responseEnvelope("workspace-trust", 1, TASK_CONTEXT, {
      ok: true,
      type: "workspace.setTrust",
      result
    });
    const reload = responseEnvelope("resource-reload", 1, TASK_CONTEXT, {
      ok: true,
      type: "resource.reload",
      result
    });

    expect(isResponseEnvelope(trust)).toBe(true);
    expect(isResponseEnvelope(reload)).toBe(true);
    expect(isResponseEnvelope({ ...trust, result: legacySnapshot() })).toBe(false);
    expect(isResponseEnvelope({ ...reload, result: legacySnapshot() })).toBe(false);
  });
});

function legacySnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    cwd: "/tmp",
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
