import { describe, expect, it } from "vitest";
import { isReplaySafeControlMutation } from "./agent-messages.js";
import {
  APP_PROTOCOL_CONTEXT,
  COMMAND_CONTEXT_SCOPE_REQUIREMENTS,
  commandEnvelope,
  eventEnvelope,
  hasValidCommandContext,
  isEventEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope,
  type TaskProtocolContext,
  type WorkspaceProtocolContext
} from "./envelope.js";

const WORKSPACE_CONTEXT: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-1"
};
const TASK_CONTEXT: TaskProtocolContext = {
  scope: "task",
  workspaceId: "workspace-1",
  taskId: "task-1",
  taskGeneration: 1
};

describe("Workspace Provider protocol", () => {
  it("requires Workspace authority and explicit replay safety for every mutation", () => {
    const queries = [
      "provider.list",
      "provider.configuration.get",
      "provider.configuration.reload"
    ] as const;
    const mutations = [
      "provider.setRuntimeKey",
      "provider.configuration.save",
      "provider.configuration.remove",
      "provider.credential.store",
      "provider.credential.remove",
      "model.default.set"
    ] as const;
    for (const type of [...queries, ...mutations]) {
      expect(COMMAND_CONTEXT_SCOPE_REQUIREMENTS[type]).toBe("workspace");
      expect(hasValidCommandContext(type, WORKSPACE_CONTEXT)).toBe(true);
      expect(hasValidCommandContext(type, APP_PROTOCOL_CONTEXT)).toBe(false);
      expect(hasValidCommandContext(type, TASK_CONTEXT)).toBe(false);
    }
    for (const type of queries) expect(isReplaySafeControlMutation(type)).toBe(false);
    for (const type of mutations) expect(isReplaySafeControlMutation(type)).toBe(true);
  });

  it("validates bounded credential input and non-secret Provider output", () => {
    const list = commandEnvelope("provider.list", {}, WORKSPACE_CONTEXT, 4);
    expect(isRequestEnvelope(list)).toBe(true);
    expect(isRequestEnvelope({ ...list, payload: { provider: "shadow" } })).toBe(false);

    const configure = commandEnvelope("provider.setRuntimeKey", {
      provider: "anthropic",
      apiKey: "runtime-secret"
    }, WORKSPACE_CONTEXT, 4, "configure-provider");
    expect(isRequestEnvelope(configure)).toBe(true);
    expect(isRequestEnvelope({ ...configure, payload: { provider: "anthropic", apiKey: "short" } })).toBe(false);
    expect(isRequestEnvelope({ ...configure, context: TASK_CONTEXT })).toBe(false);

    const response = responseEnvelope("response-provider", 4, WORKSPACE_CONTEXT, {
      ok: true,
      type: "provider.setRuntimeKey",
      result: [{
        id: "anthropic",
        label: "Anthropic",
        configured: true,
        credentialSource: "runtime",
        modelCount: 1
      }]
    });
    expect(isResponseEnvelope(response)).toBe(true);
    expect(JSON.stringify(response)).not.toContain("runtime-secret");
    if (!response.ok) throw new Error("Expected a Provider success response.");
    expect(isResponseEnvelope({
      ...response,
      result: [{ ...response.result[0], apiKey: "runtime-secret" }]
    })).toBe(false);
  });

  it("validates configuration mutations, revisions, and write-only credentials", () => {
    const revision = "a".repeat(64);
    const provider = {
      id: "custom",
      name: "Custom",
      models: [{
        id: "model-a",
        input: ["text" as const],
        reasoning: false,
        headers: [{ name: "X-Model", value: "write-only-model-header" }],
        advancedJson: "{}"
      }],
      headers: [{ name: "X-Provider", value: "write-only-provider-header" }],
      advancedJson: "{}"
    };
    const save = commandEnvelope("provider.configuration.save", {
      expectedRevision: revision,
      provider
    }, WORKSPACE_CONTEXT, 4, "save-provider");
    expect(isRequestEnvelope(save)).toBe(true);
    expect(isRequestEnvelope({ ...save, idempotencyKey: undefined })).toBe(false);
    expect(isRequestEnvelope({
      ...save,
      payload: { ...save.payload, expectedRevision: "stale" }
    })).toBe(false);
    expect(isRequestEnvelope({
      ...save,
      context: TASK_CONTEXT
    })).toBe(false);

    const credential = commandEnvelope("provider.credential.store", {
      expectedRevision: revision,
      provider: "custom",
      apiKey: "write-only-credential"
    }, WORKSPACE_CONTEXT, 4, "store-credential");
    expect(isRequestEnvelope(credential)).toBe(true);
    expect(isRequestEnvelope({
      ...credential,
      payload: { ...credential.payload, apiKey: "short" }
    })).toBe(false);

    const defaultModel = commandEnvelope("model.default.set", {
      expectedRevision: revision,
      scope: "project",
      provider: "custom",
      model: "model-a"
    }, WORKSPACE_CONTEXT, 4, "set-default-model");
    expect(isRequestEnvelope(defaultModel)).toBe(true);
    expect(isRequestEnvelope({
      ...defaultModel,
      payload: { ...defaultModel.payload, model: undefined }
    })).toBe(false);
    expect(isRequestEnvelope({
      ...defaultModel,
      payload: {
        expectedRevision: revision,
        scope: "project"
      }
    })).toBe(true);
  });

  it("accepts secret-free snapshots and Workspace change events", () => {
    const snapshot = {
      revision: "b".repeat(64),
      syncState: "current" as const,
      updatedAt: 1,
      providers: [{
        id: "custom",
        name: "Custom",
        origin: "models.json" as const,
        configured: true,
        credentialSource: "stored" as const,
        modelsJsonApiKeyConfigured: false,
        headerNames: ["X-Provider"],
        models: [{
          id: "model-a",
          input: ["text" as const],
          reasoning: false,
          headerNames: ["X-Model"],
          advancedJson: "{}"
        }],
        modelCount: 1,
        advancedJson: "{}"
      }],
      credentials: [{ provider: "custom", type: "api_key" as const }],
      defaults: {
        global: { provider: "custom", model: "model-a" },
        effective: { provider: "custom", model: "model-a" },
        projectTrusted: true
      },
      files: [
        { kind: "models" as const, path: "/fixture/models.json", exists: true, valid: true },
        { kind: "auth" as const, path: "/fixture/auth.json", exists: true, valid: true },
        { kind: "global-settings" as const, path: "/fixture/settings.json", exists: true, valid: true },
        { kind: "project-settings" as const, path: "/fixture/project/settings.json", exists: false, valid: true }
      ],
      diagnostics: []
    };
    const response = responseEnvelope("configuration", 4, WORKSPACE_CONTEXT, {
      ok: true,
      type: "provider.configuration.get",
      result: snapshot
    });
    expect(isResponseEnvelope(response)).toBe(true);

    const event = eventEnvelope("provider.configuration.changed", {
      snapshot,
      source: "external",
      changedFiles: ["models"],
      taskReload: "applied"
    }, {
      hostEpoch: 4,
      sequence: 1,
      context: WORKSPACE_CONTEXT
    });
    expect(isEventEnvelope(event)).toBe(true);
    const serialized = JSON.stringify({ response, event });
    for (const secret of [
      "write-only-model-header",
      "write-only-provider-header",
      "write-only-credential",
      "leaked-secret"
    ]) expect(serialized).not.toContain(secret);
    expect(isResponseEnvelope({
      ...response,
      result: {
        ...snapshot,
        providers: [{ ...snapshot.providers[0], apiKey: "leaked-secret" }]
      }
    })).toBe(false);
  });
});
