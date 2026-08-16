import {
  isResponseEnvelope,
  responseEnvelope,
  type AgentCommandType,
  type AppProtocolContext,
  type WorkspaceProtocolContext
} from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import { createMockProviderConfigurationSnapshot } from "./pi67-renderer-fixture.js";

const WORKSPACE_CONTEXT: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-test"
};
const APP_CONTEXT: AppProtocolContext = { scope: "app" };

const PROVIDER_SNAPSHOT_COMMANDS = [
  "provider.configuration.get",
  "provider.configuration.reload",
  "provider.configuration.save",
  "provider.configuration.remove",
  "provider.credential.store",
  "provider.credential.remove",
  "model.default.set",
  "vision.assistant.global.set"
] as const satisfies readonly AgentCommandType[];
const PROJECT_PROVIDER_SNAPSHOT_COMMANDS = [
  "provider.projectConfiguration.get",
  "provider.projectConfiguration.reload",
  "model.projectDefault.set",
  "vision.assistant.project.set"
] as const satisfies readonly AgentCommandType[];

describe("renderer Provider command fixture", () => {
  it("returns one secret-free, schema-valid snapshot shape for every Provider mutation", () => {
    const snapshot = createMockProviderConfigurationSnapshot();

    for (const type of PROVIDER_SNAPSHOT_COMMANDS) {
      const response = responseEnvelope(`fixture-${type}`, 1, APP_CONTEXT, {
        ok: true,
        type,
        result: snapshot
      } as never);
      expect(isResponseEnvelope(response), type).toBe(true);
    }
    for (const type of PROJECT_PROVIDER_SNAPSHOT_COMMANDS) {
      const response = responseEnvelope(`fixture-${type}`, 1, WORKSPACE_CONTEXT, {
        ok: true,
        type,
        result: snapshot
      } as never);
      expect(isResponseEnvelope(response), type).toBe(true);
    }

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/workspace-secret|write-only|header-value/iu);
  });

  it("accepts the explicit one-shot Provider reveal response without adding it to snapshots", () => {
    const response = responseEnvelope("fixture-provider-reveal", 1, APP_CONTEXT, {
      ok: true,
      type: "provider.credential.reveal",
      result: {
        provider: "openai",
        status: "revealed",
        apiKey: "fixture-persisted-openai-key"
      }
    });
    expect(isResponseEnvelope(response)).toBe(true);
    expect(JSON.stringify(createMockProviderConfigurationSnapshot())).not.toContain("fixture-persisted-openai-key");
  });
});
