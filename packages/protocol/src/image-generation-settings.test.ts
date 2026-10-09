import { describe, expect, it } from "vitest";
import { isReplaySafeControlMutation } from "./agent-messages.js";
import { APP_PROTOCOL_CONTEXT, commandEnvelope, isRequestEnvelope } from "./envelope.js";

const revision = "a".repeat(64);
const source = { id: "gateway", name: "本机代理", api: "openai-images" as const, provider: "codex", models: ["gpt-image-2.5-sunburst", "gpt-image-2.5"] };

describe("image generation source settings protocol", () => {
  it("is an App-scope, replay-safe mutation that validates every source", () => {
    const set = commandEnvelope("image.generation.sources.set", { expectedRevision: revision, sources: [source, { id: "ark", name: "火山方舟", api: "ark-images", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seedream-5-0-260128"] }] },
      APP_PROTOCOL_CONTEXT, 4, "set-image-sources");
    expect(isRequestEnvelope(set)).toBe(true);
    expect(isReplaySafeControlMutation(set.type)).toBe(true);
    expect(isRequestEnvelope({ ...set, idempotencyKey: undefined })).toBe(false);
    expect(isRequestEnvelope({ ...set, context: { scope: "workspace", workspaceId: "w1" } })).toBe(false);
    for (const bad of [
      { ...source, id: "Gateway" }, { ...source, id: "a".repeat(25) }, { ...source, api: "dall-e" }, { ...source, models: [] },
      { ...source, models: ["bad model"] }, { ...source, name: " " }, { ...source, baseUrl: "ftp://x" }, { ...source, apiKey: "sk-not-here" }
    ]) expect(isRequestEnvelope({ ...set, payload: { expectedRevision: revision, sources: [bad] } }), JSON.stringify(bad)).toBe(false);
    expect(isRequestEnvelope({ ...set, payload: { expectedRevision: revision, sources: Array.from({ length: 9 }, (_, i) => ({ ...source, id: `s${i}` })) } })).toBe(false);
  });
});
