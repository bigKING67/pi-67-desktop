import type { Api } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { autoRoutingDecisionOptions, parseAutoRoutingDecision } from "./auto-routing-decision.js";
import { createAutoRoutingFixture } from "./auto-routing.test-support.js";

describe("Auto structured decision boundary", () => {
  it.each(["standard", "complex"])("accepts only the declared JSON decision for %s", (decision) => {
    expect(parseAutoRoutingDecision(`\n { "complexity": "${decision}" } \n`)).toBe(decision);
  });

  it.each([
    "standard", "\"standard\"", "```json\n{\"complexity\":\"standard\"}\n```",
    "Result: {\"complexity\":\"standard\"}", "{\"complexity\":\"standard\",\"why\":\"easy\"}",
    "{\"complexity\":\"STANDARD\"}", "{\"complexity\":\"standard \"}",
    "{\"complexity\":null}", "{\"complexity\":true}", "{\"complexity\":{\"standard\":true}}",
    "{\"complexity\":\"standard\"", "{\"complexity\":\"standard\"} {}",
    "[]", "[\"standard\"]", "null", "{}", "{\"__proto__\":{\"complexity\":\"standard\"}}"
  ])("rejects an invalid or ambiguous decision: %s", (text) => {
    expect(parseAutoRoutingDecision(text)).toBeUndefined();
  });

  it.each(["openai-completions", "openai-responses", "azure-openai-responses"] as const)(
    "sends strict schema through native Pi %s and never retries a rejection", async (api) => {
      const fixture = await createAutoRoutingFixture({ autoRouting: false });
      try {
        fixture.runtime.registerProvider("schema-wire", {
          api, baseUrl: "https://schema.invalid/v1", apiKey: "synthetic",
          models: [{ id: "judge", name: "Schema fixture", reasoning: false, input: ["text"],
            contextWindow: 32000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }]
        });
        await fixture.runtime.getAvailable();
        const model = fixture.runtime.getPhysicalModel("schema-wire", "judge");
        if (!model) throw new Error("Missing synthetic judge.");
        const requests: Array<Record<string, unknown>> = [];
        const response = await fixture.runtime.completeSimple(model, {
          systemPrompt: "Classify the task; return JSON with complexity standard or complex.",
          messages: [{ role: "user", content: "Synthetic task", timestamp: 0 }]
        }, {
          maxTokens: 128, temperature: 0, maxRetries: 0,
          ...autoRoutingDecisionOptions(api),
          fetch: async (input, init) => {
            requests.push(await new Request(input, init).json() as Record<string, unknown>);
            return new Response('{"error":{"message":"Synthetic schema rejection","type":"invalid_request_error"}}', {
              status: 400, headers: { "content-type": "application/json" }
            });
          }
        });
        expect(requests).toHaveLength(1);
        const shape = { name: "pi67_task_complexity", strict: true, schema: {
          type: "object", properties: { complexity: { type: "string", enum: ["standard", "complex"] } },
          required: ["complexity"], additionalProperties: false
        } };
        expect(requests[0]).toMatchObject(api === "openai-completions"
          ? { response_format: { type: "json_schema", json_schema: shape } }
          : { text: { format: { type: "json_schema", ...shape } } });
        expect(requests[0]?.model).toBe("judge");
        expect(requests[0]?.tools).toBeUndefined();
        expect(response.stopReason).toBe("error");
      } finally { await fixture.dispose(); }
    }
  );

  it.each(["anthropic-messages", "google-generative-ai", "openai-codex-responses"] as Api[])(
    "does not inject foreign schema fields into %s", (api) => {
      expect(autoRoutingDecisionOptions(api)).toEqual({});
    }
  );

  it.each([
    { text: "standard" },
    { text: '{"complexity":"standard","extra":true}' },
    { text: '{"complexity":"complex"}', stopReason: "length" as const }
  ])("blocks candidate dispatch for rejected JSON or a truncated completion: %j", async (judgeReply) => {
    const fixture = await createAutoRoutingFixture({ judgeReply });
    try {
      await fixture.session.prompt("Synthetic classification task");
      expect(fixture.providerCalls).toEqual([{ kind: "judge", model: "judge" }]);
      expect(fixture.manager.getEntries()).toContainEqual(expect.objectContaining({
        type: "custom", customType: "pi67.auto-routing.v1",
        data: expect.objectContaining({ status: "failed", reason: "invalid-decision" })
      }));
    } finally { await fixture.dispose(); }
  });
});
