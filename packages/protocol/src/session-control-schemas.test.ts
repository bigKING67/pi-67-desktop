import type { SessionSnapshot } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { isResponseEnvelope, responseEnvelope } from "./envelope.js";

describe("Session control response schemas", () => {
  it("accepts narrow Session control results and rejects legacy full snapshots", () => {
    const controls = {
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "openai", id: "gpt-5.6" },
        thinkingLevel: "high"
      }
    };
    const select = responseEnvelope("select-model", 1, {
      ok: true,
      type: "model.select",
      result: controls
    });
    const thinking = responseEnvelope("thinking-level", 1, {
      ok: true,
      type: "thinking.set",
      result: controls
    });
    const runtimeKey = responseEnvelope("runtime-key", 1, {
      ok: true,
      type: "model.setRuntimeKey",
      result: {
        ...controls,
        modelCatalog: {
          models: [],
          providers: [],
          availableThinkingLevels: ["off", "high"]
        }
      }
    });

    expect(isResponseEnvelope(select)).toBe(true);
    expect(isResponseEnvelope(thinking)).toBe(true);
    expect(isResponseEnvelope(runtimeKey)).toBe(true);
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
