import { describe, expect, it } from "vitest";
import { isReplaySafeControlMutation } from "./agent-messages.js";
import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope,
  hasValidCommandContext,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope,
  type ProtocolContext
} from "./envelope.js";

const WORKSPACE_CONTEXT: ProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-1"
};
const TASK_CONTEXT: ProtocolContext = {
  scope: "task",
  workspaceId: "workspace-1",
  taskId: "task-1",
  taskGeneration: 1
};

describe("Extension package management protocol", () => {
  it("requires Workspace authority for queries and mutations", () => {
    expect(hasValidCommandContext("extension.package.list", WORKSPACE_CONTEXT)).toBe(true);
    expect(hasValidCommandContext("extension.package.list", APP_PROTOCOL_CONTEXT)).toBe(false);
    expect(hasValidCommandContext("extension.package.list", TASK_CONTEXT)).toBe(false);
    expect(isRequestEnvelope(commandEnvelope(
      "extension.package.list",
      {},
      WORKSPACE_CONTEXT,
      2
    ))).toBe(true);
    expect(isRequestEnvelope(commandEnvelope(
      "extension.package.list",
      {},
      APP_PROTOCOL_CONTEXT,
      2
    ))).toBe(false);
  });

  it("makes every package mutation replay-safe and strictly bounded", () => {
    const mutations = [
      ["extension.package.install", { source: "npm:example", scope: "global" }],
      ["extension.package.update", { source: "npm:example", scope: "global" }],
      ["extension.package.setEnabled", { source: "npm:example", scope: "project", enabled: false }],
      ["extension.package.restoreInheritance", { source: "npm:example" }],
      ["extension.package.uninstall", { source: "npm:example", scope: "project" }]
    ] as const;

    for (const [type, payload] of mutations) {
      expect(isReplaySafeControlMutation(type)).toBe(true);
      const request = commandEnvelope(type, payload, WORKSPACE_CONTEXT, 2, `stable-${type}`);
      expect(isRequestEnvelope(request)).toBe(true);
      const { idempotencyKey: _idempotencyKey, ...withoutKey } = request;
      expect(isRequestEnvelope(withoutKey)).toBe(false);
    }

    const install = commandEnvelope(
      "extension.package.install",
      { source: "npm:example", scope: "global" },
      WORKSPACE_CONTEXT,
      2,
      "install-example"
    );
    expect(isRequestEnvelope({ ...install, payload: { ...install.payload, raw: "no" } })).toBe(false);
    expect(isRequestEnvelope({ ...install, payload: { source: " ", scope: "global" } })).toBe(false);
    expect(isRequestEnvelope({ ...install, payload: { source: "bad\0source", scope: "global" } })).toBe(false);
    expect(isRequestEnvelope({ ...install, payload: { source: "npm:example", scope: "task" } })).toBe(false);
  });

  it("validates redacted package lists, updates and mutation results", () => {
    const listResult = {
      items: [{
        source: "npm:example",
        scope: "global" as const,
        enabled: true,
        filtered: false,
        installed: true
      }],
      total: 1
    };
    expect(isResponseEnvelope(responseEnvelope("list-1", 2, WORKSPACE_CONTEXT, {
      ok: true,
      type: "extension.package.list",
      result: listResult
    }))).toBe(true);
    expect(isResponseEnvelope(responseEnvelope("updates-1", 2, WORKSPACE_CONTEXT, {
      ok: true,
      type: "extension.package.checkUpdates",
      result: {
        items: [{
          source: "npm:example",
          scope: "global",
          type: "npm",
          displayName: "example"
        }],
        total: 1
      }
    }))).toBe(true);
    const mutation = responseEnvelope("mutation-1", 2, WORKSPACE_CONTEXT, {
      ok: true,
      type: "extension.package.install",
      result: { ...listResult, changed: true }
    });
    expect(isResponseEnvelope(mutation)).toBe(true);
    expect(isResponseEnvelope({
      ...mutation,
      result: { ...listResult, changed: true, installedPath: "/private/pi" }
    })).toBe(false);
  });
});
