import { expect, it } from "vitest";
import { Value } from "./typebox-schema.js";
import { ContextMemoryCommandPayloadSchemas, ContextMemoryCommandResultSchemas } from "./context-memory-schemas.js";
import { hasValidCommandContext } from "./protocol-context.js";
import { isReplaySafeControlMutation } from "./replay-safe-commands.js";

const id = "00000000-0000-4000-8000-000000000001";
it("admits index only with explicit scope, no executable/model authority and no replay", () => {
  const type = "enterprise.knowledge.index", schema = ContextMemoryCommandPayloadSchemas[type];
  expect(Value.Check(schema, { teamId: id, projectId: id })).toBe(true);
  for (const extra of [{ teamId: "bad" }, { projectId: null }, { accessToken: "forged" }, { root: "/arbitrary" }, { models: {} }, { maxPages: 100 }]) {
    expect(Value.Check(schema, { teamId: id, ...extra })).toBe(false);
  }
  expect(hasValidCommandContext(type, { scope: "app" })).toBe(true);
  expect(hasValidCommandContext(type, { scope: "workspace", workspaceId: id })).toBe(false);
  expect(isReplaySafeControlMutation(type)).toBe(false);
  const result = { state: "published-local", snapshot: { epoch: id, cursor: "1" } };
  expect(Value.Check(ContextMemoryCommandResultSchemas[type], result)).toBe(true);
  expect(Value.Check(ContextMemoryCommandResultSchemas[type], { ...result, ready: true })).toBe(false);
  expect(Value.Check(ContextMemoryCommandResultSchemas[type], { ...result, state: "ready" })).toBe(false);
  expect(Value.Check(ContextMemoryCommandResultSchemas[type], { ...result, snapshot: { epoch: id, cursor: "0" } })).toBe(false);
});
it("accepts explicit team/project sync selections but no credentials, paths or excessive budgets", () => {
  const schema = ContextMemoryCommandPayloadSchemas["enterprise.knowledge.sync"];
  expect(hasValidCommandContext("enterprise.knowledge.sync", { scope: "app" })).toBe(true);
  expect(hasValidCommandContext("enterprise.knowledge.sync", { scope: "workspace", workspaceId: id })).toBe(false);
  expect(hasValidCommandContext("enterprise.knowledge.sync", {
    scope: "task", workspaceId: id, taskId: id, taskGeneration: 1
  })).toBe(false);
  expect(isReplaySafeControlMutation("enterprise.knowledge.sync")).toBe(false);
  expect(Value.Check(schema, { teamId: id })).toBe(true);
  expect(Value.Check(schema, { teamId: id, projectId: id, maxPages: 100 })).toBe(true);
  for (const extra of [{ teamId: "bad" }, { projectId: null }, { maxPages: 101 }, { maxPages: 0 }, { accessToken: "forged" }, { root: "/arbitrary" }]) {
    expect(Value.Check(schema, { teamId: id, ...extra })).toBe(false);
  }
});
it("returns receipt progress without exposing shared content or credentials", () => {
  const schema = ContextMemoryCommandResultSchemas["enterprise.knowledge.sync"];
  const result = { progress: { epoch: null, cursor: "0" }, pages: 1, headCursor: "0" };
  expect(Value.Check(schema, result)).toBe(true);
  expect(Value.Check(schema, { ...result, pageJson: "private" })).toBe(false);
});
