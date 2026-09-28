import { describe, expect, it } from "vitest";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { Value } from "./typebox-schema.js";

describe("deprecated approvalMode payload field", () => {
  it("is optional for current senders and still accepted from older senders", () => {
    for (const [type, payload] of [
      ["runtime.initialize", { cwd: "/w", trust: "trusted" }],
      ["workspace.open", { cwd: "/w", trust: "trusted" }],
      ["workspace.register", { cwd: "/w", trust: "trusted" }],
      ["workspace.setTrust", { trust: "trusted" }]
    ] as const) {
      expect(Value.Check(CommandPayloadSchemas[type], payload), type).toBe(true);
      expect(Value.Check(CommandPayloadSchemas[type], { ...payload, approvalMode: "balanced" }), type).toBe(true);
      expect(Value.Check(CommandPayloadSchemas[type], { ...payload, approvalMode: "ask" }), type).toBe(false);
    }
  });
});
