import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isEventEnvelope,
  isResponseEnvelope,
  type AgentCommandType,
  type CommandPayloads,
  type ProtocolContext,
  type ResponseEnvelope,
  type WorkspaceProtocolContext
} from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { attach, FakePort } from "./host-server-multi-task-fixture.js";
import { commandEnvelopeForContext } from "./protocol-test-fixtures.js";

const WORKSPACE: WorkspaceProtocolContext = { scope: "workspace", workspaceId: "workspace-1" };
// This integration path creates and refreshes real Pi ModelRuntime instances.
const HOST_RESPONSE_TIMEOUT_MS = 60_000;
const PROVIDER_CONFIGURATION_TEST_TIMEOUT_MS = 120_000;
const ENVIRONMENT_KEYS = [
  "PI_CODING_AGENT_DIR",
  "PI67_SESSION_CATALOG_DIR",
  "PI67_STORAGE_ROOT"
] as const;
const temporaryDirectories: string[] = [];
let previousEnvironment: Record<(typeof ENVIRONMENT_KEYS)[number], string | undefined>;

describe("AgentHostServer Provider configuration", () => {
  beforeEach(() => {
    previousEnvironment = Object.fromEntries(
      ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
    ) as typeof previousEnvironment;
  });

  afterEach(async () => {
    for (const key of ENVIRONMENT_KEYS) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("routes Pi file mutations without loading a Task and never returns write-only values", async () => {
    const fixture = await createFixture();
    const runtimeLoader = vi.fn(async () => { throw new Error("Task Runtime must not load."); });
    const server = new AgentHostServer(runtimeLoader, { sdkVersionLoader: async () => "0.81.1" });
    const port = new FakePort();
    await attach(server, port);
    try {
      expect((await hostCommand(port, WORKSPACE, "workspace.register", {
        cwd: fixture.cwd,
        trust: "trusted",
        approvalMode: "guided"
      }, "register-provider-workspace")).response).toMatchObject({ ok: true });

      const initialResponse = (await hostCommand(
        port,
        WORKSPACE,
        "provider.configuration.get",
        {}
      )).response;
      if (!initialResponse.ok) throw new Error(initialResponse.error.message);
      expect(initialResponse.result.providers.some((provider) => (
        provider.origin === "builtin" && provider.models.length > 0
      ))).toBe(true);

      const savePayload = {
        expectedRevision: initialResponse.result.revision,
        provider: {
          id: "pi67-host-test",
          name: "Host Test",
          baseUrl: "https://example.invalid/v1",
          api: "openai-responses",
          headers: [{ name: "X-Write-Only", value: "fixture-provider-header-value" }],
          models: [{
            id: "fixture-model",
            input: ["text" as const],
            reasoning: false,
            headers: [{ name: "X-Model-Write-Only", value: "fixture-model-header-value" }]
          }]
        }
      };
      const savedResponse = (await hostCommand(
        port,
        WORKSPACE,
        "provider.configuration.save",
        savePayload,
        "save-provider"
      )).response;
      if (!savedResponse.ok) throw new Error(savedResponse.error.message);
      expect(savedResponse.result.providers).toContainEqual(expect.objectContaining({
        id: "pi67-host-test",
        headerNames: ["X-Write-Only"],
        models: [expect.objectContaining({
          id: "fixture-model",
          headerNames: ["X-Model-Write-Only"]
        })]
      }));
      expect(JSON.stringify(savedResponse)).not.toContain("fixture-provider-header-value");
      expect(JSON.stringify(savedResponse)).not.toContain("fixture-model-header-value");
      expect(await readFile(join(fixture.agentDir, "models.json"), "utf8"))
        .toContain("fixture-provider-header-value");

      const replayResponse = (await hostCommand(
        port,
        WORKSPACE,
        "provider.configuration.save",
        savePayload,
        "save-provider"
      )).response;
      expect(replayResponse).toMatchObject({
        ok: true,
        type: savedResponse.type,
        result: savedResponse.result
      });

      const credentialValue = "fixture-persistent-host-credential";
      const credentialResponse = (await hostCommand(port, WORKSPACE, "provider.credential.store", {
        expectedRevision: savedResponse.result.revision,
        provider: "pi67-host-test",
        apiKey: credentialValue
      }, "store-provider-credential")).response;
      if (!credentialResponse.ok) throw new Error(credentialResponse.error.message);
      expect(credentialResponse.result.credentials).toContainEqual({
        provider: "pi67-host-test",
        type: "api_key"
      });
      expect(JSON.stringify(credentialResponse)).not.toContain(credentialValue);
      expect(await readFile(join(fixture.agentDir, "auth.json"), "utf8")).toContain(credentialValue);

      const revealResponse = (await hostCommand(port, WORKSPACE, "provider.credential.reveal", {
        expectedRevision: credentialResponse.result.revision,
        provider: "pi67-host-test"
      })).response;
      expect(revealResponse).toMatchObject({
        ok: true,
        result: {
          provider: "pi67-host-test",
          status: "revealed",
          apiKey: credentialValue
        }
      });

      const conflictingResponse = (await hostCommand(port, WORKSPACE, "provider.credential.store", {
        expectedRevision: savedResponse.result.revision,
        provider: "pi67-host-test",
        apiKey: "different-fixture-credential"
      }, "store-provider-credential")).response;
      expect(conflictingResponse).toMatchObject({
        ok: false,
        error: { code: "DUPLICATE_REQUEST" }
      });
      expect(JSON.stringify(conflictingResponse)).not.toContain(credentialValue);
      expect(JSON.stringify(conflictingResponse)).not.toContain("different-fixture-credential");

      const defaultResponse = (await hostCommand(port, WORKSPACE, "model.default.set", {
        expectedRevision: credentialResponse.result.revision,
        scope: "global",
        provider: "pi67-host-test",
        model: "fixture-model"
      }, "set-provider-default")).response;
      if (!defaultResponse.ok) throw new Error(JSON.stringify(defaultResponse.error));
      expect(defaultResponse).toMatchObject({
        ok: true,
        result: {
          defaults: {
            global: { provider: "pi67-host-test", model: "fixture-model" }
          }
        }
      });
      expect(runtimeLoader).not.toHaveBeenCalled();

      const configurationEvents = port.sent.filter((candidate) => (
        isEventEnvelope(candidate) && candidate.type === "provider.configuration.changed"
      ));
      expect(configurationEvents.length).toBeGreaterThanOrEqual(3);
      expect(configurationEvents.every((event) => (
        isEventEnvelope(event) && event.context.scope === "workspace"
      ))).toBe(true);
      const serializedEvents = JSON.stringify(configurationEvents);
      for (const secret of [
        credentialValue,
        "fixture-provider-header-value",
        "fixture-model-header-value"
      ]) expect(serializedEvents).not.toContain(secret);
    } finally {
      await server.shutdown();
    }
  }, PROVIDER_CONFIGURATION_TEST_TIMEOUT_MS);

});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-host-provider-"));
  temporaryDirectories.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const catalogDirectory = join(root, "catalog");
  await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(catalogDirectory)]);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI67_SESSION_CATALOG_DIR = catalogDirectory;
  process.env.PI67_STORAGE_ROOT = root;
  return { cwd, agentDir };
}

async function hostCommand<T extends AgentCommandType>(
  port: FakePort,
  context: ProtocolContext,
  type: T,
  payload: CommandPayloads[T],
  idempotencyKey?: string
): Promise<{ response: ResponseEnvelope<T> }> {
  const request = commandEnvelopeForContext(type, payload, context, 7, idempotencyKey);
  port.emit(request);
  const phase = "awaiting-correlated-response";
  let response: ResponseEnvelope<T> | undefined;
  try {
    await vi.waitFor(() => {
      response = port.sent.find((candidate) => (
        isResponseEnvelope(candidate) && candidate.requestId === request.requestId
      )) as ResponseEnvelope<T> | undefined;
      expect(response).toBeDefined();
    }, { timeout: HOST_RESPONSE_TIMEOUT_MS, interval: 20 });
  } catch (error) {
    const recent = port.sent.slice(-8).map(safeProtocolMessageSummary);
    throw new Error(
      `Timed out waiting for Host response: command=${type} requestId=${request.requestId} phase=${phase} recent=${JSON.stringify(recent)}`,
      { cause: error }
    );
  }
  if (!response) throw new Error("Expected a correlated Host response.");
  return { response };
}

function safeProtocolMessageSummary(value: unknown): Record<string, string | number | boolean> {
  if (typeof value !== "object" || value === null) return { kind: typeof value };
  const candidate = value as Record<string, unknown>;
  return {
    ...(typeof candidate.kind === "string" ? { kind: candidate.kind } : {}),
    ...(typeof candidate.type === "string" ? { type: candidate.type } : {}),
    ...(typeof candidate.requestId === "string" ? { requestId: candidate.requestId } : {}),
    ...(typeof candidate.hostEpoch === "number" ? { hostEpoch: candidate.hostEpoch } : {}),
    ...(typeof candidate.ok === "boolean" ? { ok: candidate.ok } : {})
  };
}
