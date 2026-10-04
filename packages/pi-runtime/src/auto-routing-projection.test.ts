import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ConversationPageSchema } from "../../protocol/src/message-schemas.js";
import { Value } from "../../protocol/src/typebox-schema.js";
import { describe, expect, it } from "vitest";
import { AUTO_ROUTING_ENTRY } from "./auto-routing-evidence.js";
import { projectMessagePage } from "./message-projection.js";

const evidence = { version: 1, createdAt: 1, status: "selected", reason: "complex",
  judge: { provider: "fixture", model: "judge" }, selected: { provider: "fixture", model: "deep" },
  inputTruncated: false, totalTokens: 25, totalCost: 0.0001 };

describe("native Auto decision projection", () => {
  it("projects decision evidence and its cursor without adding model context", () => {
    const manager = SessionManager.inMemory("/tmp");
    const id = manager.appendCustomEntry(AUTO_ROUTING_ENTRY, { ...evidence, legacyBody: "must not escape" });
    const page = projectMessagePage(manager);
    expect(page.messages[0]).toMatchObject({ id, role: "system", parts: [{ type: "auto-routing", reason: "complex" }] });
    expect(JSON.stringify(page)).not.toContain("must not escape");
    expect(Value.Check(ConversationPageSchema, page)).toBe(true);
    expect(manager.buildSessionContext().messages).toHaveLength(0);
    expect(projectMessagePage(manager, { cursor: id, direction: "older" }).messages).toHaveLength(0);
  });
  it.each([{ totalCost: Infinity }, { totalTokens: -1 }, { judge: null }, { selected: undefined }, { reason: "invented" }])("ignores invalid stored evidence %j", (patch) => {
    const manager = SessionManager.inMemory("/tmp");
    manager.appendCustomEntry(AUTO_ROUTING_ENTRY, { ...evidence, ...patch });
    expect(projectMessagePage(manager).messages).toHaveLength(0);
  });
});
