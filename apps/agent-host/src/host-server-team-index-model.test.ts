import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { TeamIndexSettingsClient } from "./context/team-index-settings-client.js";
import { EnterpriseCredentialBrokerClient } from "./context/enterprise-credential-broker-client.js";
import { TeamWorkerBrokerClient } from "./context/team-worker-broker-client.js";

it("composes private settings, real synthetic Pi auth and the index owner; invalidation cancels pending authorization before receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-host-team-model-")), agentDir = join(root, "agent"); await mkdir(agentDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir); vi.stubEnv("PI67_STORAGE_ROOT", root); vi.stubEnv("PI67_SESSION_CATALOG_DIR", join(root, "catalog"));
  const modelSettings = { extraction: { provider: "fixture", model: "extract" }, embedding: {
    protocol: "openai-compatible", endpoint: "https://model.invalid/v1", model: "embed", dimension: 4, apiKey: "synthetic-embedding"
  } };
  const parent = { postMessage: vi.fn() }, settings = new TeamIndexSettingsClient(parent);
  parent.postMessage.mockImplementation(message => { if (message.type === "team-index-settings-read") settings.handleMessage({ type: "team-index-settings-result", requestId: message.requestId, ok: true, settings: modelSettings }); });
  const credentialParent = { postMessage: vi.fn() }, credentials = new EnterpriseCredentialBrokerClient(credentialParent), workers = new TeamWorkerBrokerClient(parent);
  const credential = { endpoint: "https://service.invalid", accessToken: "synthetic-service", userId: "user", accountId: "00000000-0000-4000-8000-000000000001", expiresAt: Date.now() + 600_000 };
  credentials.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential });
  let release!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; })); vi.stubGlobal("fetch", fetcher);
  const runtime = vi.fn(async () => { throw new Error("Agent must not load"); });
  let server: AgentHostServer | undefined;
  try {
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: "https://model.invalid/v1", models: [{ id: "extract", input: ["text"], reasoning: false }] } } }));
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "synthetic-extraction" } }));
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({ enterpriseGatewayEndpoint: credential.endpoint }));
    server = new AgentHostServer(runtime, { agentDir, enterpriseCredentialBroker: credentials, teamIndexSettings: settings, teamWorkers: workers });
    const run = server.teamKnowledge.index({ teamId: credential.accountId, projectId: null, signal: new AbortController().signal });
    const rejected = expect(run).rejects.toThrow();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { timeout: 5_000 });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://service.invalid/v1/agent/teams/${credential.accountId}/authorization`);
    settings.handleMessage({ type: "team-index-settings-invalidated" });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    release(Response.json({}, { status: 403 })); await rejected;
    expect(parent.postMessage.mock.calls.map(([message]) => message.type)).toEqual(["team-index-settings-read"]);
    expect(credentialParent.postMessage).not.toHaveBeenCalled(); expect(runtime).not.toHaveBeenCalled();
    await server.shutdown();
    await expect(server.teamKnowledge.index({ teamId: credential.accountId, projectId: null, signal: new AbortController().signal })).rejects.toThrow("unavailable");
  } finally {
    try { await server?.shutdown(); settings.shutdown(); credentials.shutdown(); workers.shutdown(); }
    finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
  }
}, 15_000);
