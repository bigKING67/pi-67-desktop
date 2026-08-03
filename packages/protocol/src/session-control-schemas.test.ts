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

describe("Session control response schemas", () => {
  it("requires model selection to return its catalog while thinking stays narrow", () => {
    const controls = {
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "openai", id: "gpt-5.6" },
        thinkingLevel: "high"
      }
    };
    const modelCatalog = {
      ...controls,
      modelCatalog: {
        models: [],
        providers: [],
        availableThinkingLevels: ["off", "high"]
      }
    };
    const select = responseEnvelope("select-model", 1, TASK_CONTEXT, {
      ok: true,
      type: "model.select",
      result: modelCatalog
    });
    const thinking = responseEnvelope("thinking-level", 1, TASK_CONTEXT, {
      ok: true,
      type: "thinking.set",
      result: controls
    });
    const runtimeKey = responseEnvelope("runtime-key", 1, TASK_CONTEXT, {
      ok: true,
      type: "model.setRuntimeKey",
      result: modelCatalog
    });

    expect(isResponseEnvelope(select)).toBe(true);
    expect(isResponseEnvelope(thinking)).toBe(true);
    expect(isResponseEnvelope(runtimeKey)).toBe(true);
    expect(isResponseEnvelope({ ...select, result: controls })).toBe(false);
    expect(isResponseEnvelope({ ...select, result: legacySnapshot() })).toBe(false);
    expect(isResponseEnvelope({ ...thinking, result: legacySnapshot() })).toBe(false);
    expect(isResponseEnvelope({ ...runtimeKey, result: legacySnapshot() })).toBe(false);
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
