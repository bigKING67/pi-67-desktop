import { describe, expect, it } from "vitest";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { Value } from "./typebox-schema.js";

// approvalMode left the wire in this protocol revision; the Host default is the only policy input.
describe("removed approvalMode payload field", () => {
  it("accepts policy payloads without approvalMode and rejects it on every former carrier", () => {
    for (const [type, payload] of [
      ["runtime.initialize", { cwd: "/w", trust: "trusted" }],
      ["workspace.open", { cwd: "/w", trust: "trusted" }],
      ["workspace.register", { cwd: "/w", trust: "trusted" }],
      ["workspace.setTrust", { trust: "trusted" }]
    ] as const) {
      expect(Value.Check(CommandPayloadSchemas[type], payload), type).toBe(true);
      expect(Value.Check(CommandPayloadSchemas[type], { ...payload, approvalMode: "balanced" }), type).toBe(false);
    }
  });
});
