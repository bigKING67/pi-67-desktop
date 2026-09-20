import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { SharedKnowledgeReceiptRequest } from "@pi67/protocol";
import { EnterpriseContextController } from "./enterprise-context-controller.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";
import { createTeamQueryEmbedding } from "./team-query-embedding.js";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION } from "@pi67/domain";

const id = "00000000-0000-4000-8000-000000000001", snapshot = { epoch: id, cursor: "1" };
const teamId = "00000000-0000-4000-8000-000000000002", projectId = "00000000-0000-4000-8000-000000000003";
const model = { endpoint: "https://embed.invalid/v1", model: "embed", dimension: 4 };
const agentModel = { baseUrl: "https://agent.invalid/v1", id: "agent" };
const canonicalContent = JSON.stringify(["newmoney.knowledge.v1", "sop", "title", "summary", "body"]);
const contentRevision = createHash("sha256").update(canonicalContent).digest("hex");
const controllers: EnterpriseContextController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.shutdown(); vi.unstubAllGlobals(); enterprisePowerEpoch.transition("resume"); vi.useRealTimers(); });
function fixture(allowAgent = false) {
  const credential = { endpoint: "https://service.invalid", accessToken: "synthetic-token", userId: "user", accountId: teamId, expiresAt: Date.now() + 600_000 };
  const messages: SharedKnowledgeReceiptRequest[] = [];
  const parent = { postMessage: vi.fn() }, broker = new EnterpriseCredentialBrokerClient(parent);
  const bootstrap = () => broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential }); bootstrap();
  const reply = (message: SharedKnowledgeReceiptRequest) => {
    const base = { type: `${message.type}-result`, requestId: message.requestId, ok: true };
    if (message.type === "shared-knowledge-receipt-open") broker.handleReceiptResult({ ...base, handleId: id,
      userId: credential.userId, endpoint: credential.endpoint, progress: { epoch: null, cursor: "0" } });
    if (message.type === "shared-knowledge-index-query-prepare") broker.handleReceiptResult({ ...base, queryId: id, model, snapshot });
    if (message.type === "shared-knowledge-index-query") broker.handleReceiptResult({ ...base, snapshot, hits: [] });
    if (message.type === "shared-knowledge-index-read") broker.handleReceiptResult({ ...base, snapshot, assetId: id, contentRevision, canonicalContent });
    if (message.type === "shared-knowledge-receipt-close") broker.handleReceiptResult(base);
  };
  parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => { messages.push(message); reply(message); });
  const configuration = { read: vi.fn(async () => ({ ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION, enterpriseGatewayEndpoint: credential.endpoint })) };
  const controller = new EnterpriseContextController(configuration as never, { require() { throw new Error("Synthetic rebind stopped"); } } as never, { sendFor() {} } as never, broker);
  controllers.push(controller);
  const caller = new AbortController(), source = createTeamQueryEmbedding({ ...model, protocol: "openai-compatible", apiKey: "synthetic-key" }, caller.signal);
  const loadEmbedding = vi.fn(async () => source);
  const input = { teamId, projectId, workspaceId: "workspace", query: "synthetic-query", limit: 1, signal: caller.signal, loadEmbedding };
  const fetcher = vi.fn<typeof fetch>(async url => (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith("/authorization")
    ? Response.json({ userId: "user", teamId, projectId, role: "member", permissionRevision: "a".repeat(64), issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      modelPolicy: { teamId, revision: "1", allowedModels: [{ purpose: "embedding", endpoint: model.endpoint, modelId: model.model },
        ...(allowAgent ? [{ purpose: "agent", endpoint: agentModel.baseUrl, modelId: agentModel.id }] : [])] } })
    : Response.json({ model: "embed", data: [{ index: 0, embedding: [1, 2, 3, 4] }] }));
  vi.stubGlobal("fetch", fetcher);
  const retire = async (action: string) => {
    if (action === "caller") caller.abort();
    if (action === "credential") bootstrap();
    if (action === "config") controller.retireTeamModelChannels();
    if (action === "shutdown") controller.shutdown();
    if (action === "suspend") enterprisePowerEpoch.transition("suspend");
    if (action === "rebind") await controller.bindWorkspace("workspace", teamId, "next", "fixture").catch(() => undefined);
  };
  return { broker, controller, input, caller, parent, messages, reply, fetcher, loadEmbedding, source, retire, configuration, credential };
}
it.each(["disabled", "off"])("blocks %s memory before credentials, receipts or model processing", async (mode) => {
  const f = fixture(true);
  f.configuration.read.mockResolvedValue({ ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION,
    enterpriseGatewayEndpoint: f.credential.endpoint, enabled: mode !== "disabled",
    defaultPrivacyMode: mode === "off" ? "off" : "private-learning" });
  await expect(f.controller.searchKnowledge(f.input)).rejects.toThrow("disabled in memory settings");
  await expect(f.controller.embedKnowledgeQuery({ ...f.input, expectedModel: model })).rejects.toThrow("disabled in memory settings");
  await expect(f.controller.readKnowledge({ teamId, projectId, workspaceId: "workspace", assetId: id,
    contentRevision, snapshot, signal: f.caller.signal })).rejects.toThrow("disabled in memory settings");
  expect(f.parent.postMessage).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.loadEmbedding).not.toHaveBeenCalled();
});

it("runs scoped Main preparation before the project-authorized embedding and closes the metadata result", async () => {
  const f = fixture();
  expect(await f.controller.searchKnowledge(f.input)).toEqual({ snapshot, hits: [] });
  expect(f.messages.map(message => message.type)).toEqual(["shared-knowledge-receipt-open", "shared-knowledge-index-query-prepare", "shared-knowledge-index-query", "shared-knowledge-receipt-close"]);
  expect(f.messages[0]).toMatchObject({ scope: { teamId, scopeKind: "project", scopeId: projectId } });
  expect(f.fetcher.mock.calls[0]![0]).toBe(`https://service.invalid/v1/agent/teams/${teamId}/projects/${projectId}/authorization`);
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it("preserves a sanitized preparation failure through the real receipt client and Session query owner", async () => {
  const f = fixture(true);
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => {
    f.messages.push(message);
    if (message.type === "shared-knowledge-index-query-prepare") f.broker.handleReceiptResult({
      type: "shared-knowledge-index-query-prepare-result", requestId: message.requestId, ok: false, errorCode: "QUERY_FAILED"
    });
    else f.reply(message);
  });
  await expect(f.controller.searchSessionKnowledge({ ...f.input, ...sessionInput(f) })).rejects.toMatchObject({
    message: "Shared knowledge query unavailable. Stage: index-preparation.", stage: "index-preparation"
  });
  expect(f.loadEmbedding).not.toHaveBeenCalled();
  expect(f.fetcher).toHaveBeenCalledOnce(); // Agent admission only; no embedding provider.
  expect(f.messages.map(message => message.type)).toEqual([
    "shared-knowledge-receipt-open", "shared-knowledge-index-query-prepare", "shared-knowledge-receipt-close"
  ]);
});
it("keeps authorized search available in read-only memory mode", async () => {
  const f = fixture();
  f.configuration.read.mockResolvedValue({ ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION,
    enterpriseGatewayEndpoint: f.credential.endpoint, defaultPrivacyMode: "read-only" });
  await expect(f.controller.searchKnowledge(f.input)).resolves.toEqual({ snapshot, hits: [] });
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it.each(["caller", "credential", "config", "shutdown", "suspend", "rebind"])("retires preparation before paid processing: %s", async action => {
  const f = fixture(); let prepared!: SharedKnowledgeReceiptRequest;
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => { f.messages.push(message); if (message.type === "shared-knowledge-index-query-prepare") prepared = message; else f.reply(message); });
  const run = f.controller.searchKnowledge(f.input), rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(prepared).toBeDefined()); await f.retire(action); f.reply(prepared); await rejected;
  expect(f.loadEmbedding).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  expect(f.messages.some(message => message.type === "shared-knowledge-receipt-close")).toBe(true);
});
it.each(["caller", "credential", "config", "shutdown", "suspend", "rebind"])("withholds late query hits after %s", async action => {
  const f = fixture(); let query!: SharedKnowledgeReceiptRequest;
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => { f.messages.push(message); if (message.type === "shared-knowledge-index-query") query = message; else f.reply(message); });
  const run = f.controller.searchKnowledge(f.input), rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(query).toBeDefined()); await f.retire(action); f.reply(query); await rejected;
  expect(f.messages.some(message => message.type === "shared-knowledge-receipt-close")).toBe(true);
});
it("does not call a provider when Main rejects the local index", async () => {
  const f = fixture();
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => {
    if (message.type === "shared-knowledge-index-query-prepare") f.broker.handleReceiptResult({ type: `${message.type}-result`, requestId: message.requestId, ok: false, errorCode: "QUERY_FAILED" });
    else f.reply(message);
  });
  await expect(f.controller.searchKnowledge(f.input)).rejects.toThrow("unavailable"); expect(f.loadEmbedding).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
});
it("denies model selection drift before authorization or paid processing", async () => {
  const f = fixture(); f.loadEmbedding.mockResolvedValue(createTeamQueryEmbedding({ ...model, model: "different", protocol: "openai-compatible", apiKey: "synthetic-key" }, f.caller.signal));
  await expect(f.controller.searchKnowledge(f.input)).rejects.toThrow("unavailable"); expect(f.fetcher).not.toHaveBeenCalled();
  expect(f.messages.at(-1)!.type).toBe("shared-knowledge-receipt-close");
});
it("holds all four shared query slots through cancelled embedding settlement", async () => {
  const f = fixture(), releases: Array<(source: typeof f.source) => void> = [];
  f.loadEmbedding.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
  const runs = Array.from({ length: 4 }, () => f.controller.searchKnowledge(f.input)), rejected = runs.map(run => expect(run).rejects.toThrow());
  await vi.waitFor(() => expect(releases).toHaveLength(4)); await f.retire("config");
  await expect(f.controller.searchKnowledge(f.input)).rejects.toThrow();
  await expect(f.controller.embedKnowledgeQuery({ ...f.input, expectedModel: model })).rejects.toThrow();
  expect(f.loadEmbedding).toHaveBeenCalledTimes(4);
  for (const release of releases) release(f.source); await Promise.all(rejected);
  f.loadEmbedding.mockResolvedValue(f.source);
  await expect(f.controller.searchKnowledge(f.input)).resolves.toEqual({ snapshot, hits: [] });
});
it.each([0, 101, 1.5])("refuses invalid limit %s without IO", async limit => {
  const f = fixture(); await expect(f.controller.searchKnowledge({ ...f.input, limit })).rejects.toThrow(); expect(f.messages).toEqual([]); expect(f.configuration.read).not.toHaveBeenCalled();
});
it("refuses invalid query and signed-out searches without preparing an index", async () => {
  const f = fixture(); await expect(f.controller.searchKnowledge({ ...f.input, query: "" })).rejects.toThrow();
  f.broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available" });
  await expect(f.controller.searchKnowledge(f.input)).rejects.toThrow(); expect(f.messages).toEqual([]); expect(f.loadEmbedding).not.toHaveBeenCalled();
});
it("rejects clock rollback during settings resolution before processing", async () => {
  const f = fixture(); vi.useFakeTimers({ toFake: ["Date"] }); const now = Date.now();
  f.loadEmbedding.mockImplementation(async () => { vi.setSystemTime(now - 1000); return f.source; });
  await expect(f.controller.searchKnowledge(f.input)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
});
it.each(["deadline", "credential"])("rejects expired %s at the final close boundary", async kind => {
  const f = fixture(); vi.useFakeTimers({ toFake: ["Date"] }); const now = Date.now();
  if (kind === "credential") f.broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential: { ...f.credential, expiresAt: now + 40_000 } });
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => {
    if (message.type === "shared-knowledge-receipt-close") vi.setSystemTime(kind === "deadline" ? now + 60_001 : now + 40_001);
    f.reply(message);
  });
  await expect(f.controller.searchKnowledge(f.input)).rejects.toThrow("unavailable"); expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it("denies project model policy before the embedding request and closes the prepared index", async () => {
  const f = fixture(); f.fetcher.mockResolvedValue(Response.json({}, { status: 403 }));
  await expect(f.controller.searchKnowledge(f.input)).rejects.toThrow("unavailable"); expect(f.fetcher).toHaveBeenCalledOnce();
  expect(f.messages.at(-1)!.type).toBe("shared-knowledge-receipt-close");
  expect(f.messages.some(message => message.type === "shared-knowledge-index-query")).toBe(false);
});
it("reads exact content through the captured project identity without invoking any model", async () => {
  const f = fixture();
  const result = await f.controller.readKnowledge({ teamId, projectId, workspaceId: "workspace", signal: f.caller.signal, snapshot, assetId: id, contentRevision });
  expect(result).toEqual({ snapshot, assetId: id, contentRevision, content: { kind: "sop", title: "title", summary: "summary", body: "body" } });
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.loadEmbedding).not.toHaveBeenCalled();
  expect(f.messages.map(message => message.type)).toEqual(["shared-knowledge-receipt-open", "shared-knowledge-index-read", "shared-knowledge-receipt-close"]);
});
it.each(["caller", "credential", "config", "shutdown", "suspend", "rebind"])("discards late body bytes after %s", async action => {
  const f = fixture(); let reading!: SharedKnowledgeReceiptRequest;
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => { f.messages.push(message); if (message.type === "shared-knowledge-index-read") reading = message; else f.reply(message); });
  const run = f.controller.readKnowledge({ teamId, projectId, workspaceId: "workspace", signal: f.caller.signal, snapshot, assetId: id, contentRevision });
  const rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(reading).toBeDefined()); await f.retire(action); f.reply(reading); await rejected;
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.messages.some(message => message.type === "shared-knowledge-receipt-close")).toBe(true);
});

function sessionInput(f: ReturnType<typeof fixture>, scope: "team" | "project" = "project") {
  return { identity: { userId: "user", teamId, projectId, endpoint: "https://service.invalid/" },
    model: { ...agentModel }, scope, workspaceId: "workspace", signal: f.caller.signal };
}
function sessionRead(f: ReturnType<typeof fixture>, scope: "team" | "project" = "project") {
  return { ...sessionInput(f, scope), snapshot: { ...snapshot }, assetId: id, contentRevision };
}

it.each(["team", "project"] as const)("authorizes the birth project and Agent model before reading %s content", async scope => {
  const f = fixture(true);
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => {
    expect(f.fetcher).toHaveBeenCalledOnce(); f.messages.push(message); f.reply(message);
  });
  expect(await f.controller.readSessionKnowledge(sessionRead(f, scope))).toMatchObject({ assetId: id, contentRevision, content: { body: "body" } });
  expect(f.fetcher.mock.calls[0]![0]).toBe(`https://service.invalid/v1/agent/teams/${teamId}/projects/${projectId}/authorization`);
  expect(f.messages[0]).toMatchObject({ scope: { teamId, scopeKind: scope, scopeId: scope === "team" ? teamId : projectId } });
  expect(f.loadEmbedding).not.toHaveBeenCalled();
});

it("checks Agent admission before Main preparation, then independently admits query embedding", async () => {
  const f = fixture(true);
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => {
    if (message.type === "shared-knowledge-receipt-open") expect(f.fetcher).toHaveBeenCalledOnce();
    f.messages.push(message); f.reply(message);
  });
  await expect(f.controller.searchSessionKnowledge({ ...f.input, ...sessionInput(f) })).resolves.toEqual({ snapshot, hits: [] });
  expect(f.fetcher).toHaveBeenCalledTimes(3);
  expect(f.fetcher.mock.calls.slice(0, 2).map(call => call[0])).toEqual(Array(2).fill(`https://service.invalid/v1/agent/teams/${teamId}/projects/${projectId}/authorization`));
  expect(f.loadEmbedding).toHaveBeenCalledOnce();
});

it.each(["user", "endpoint"])("rejects a Session %s mismatch before remote access or Main receipt open", async field => {
  const f = fixture(true), input = sessionRead(f);
  if (field === "user") input.identity.userId = "other";
  else input.identity.endpoint = "https://other.invalid/";
  await expect(f.controller.readSessionKnowledge(input)).rejects.toThrow("unavailable");
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.messages).toEqual([]);
});

it.each(["denied", "embedding-only", "model-id", "model-endpoint", "missing-model", "wrong-project"])("rejects %s without reading content or paid processing", async failure => {
  const f = fixture(failure !== "embedding-only"), input = { ...f.input, ...sessionInput(f) };
  if (failure === "denied") f.fetcher.mockResolvedValue(Response.json({}, { status: 403 }));
  if (failure === "model-id") input.model.id = "not-allowed";
  if (failure === "model-endpoint") input.model.baseUrl = "https://other.invalid/v1";
  if (failure === "missing-model") input.model = undefined as never;
  if (failure === "wrong-project") input.identity.projectId = teamId;
  await expect(f.controller.searchSessionKnowledge(input)).rejects.toThrow("unavailable");
  expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.messages).toEqual([]); expect(f.loadEmbedding).not.toHaveBeenCalled();
});

it("captures identity, request model, scope and body version before any asynchronous work", async () => {
  const f = fixture(true), input = sessionRead(f), original = f.configuration.read.getMockImplementation()!;
  f.configuration.read.mockImplementation(async () => {
    input.identity.teamId = "changed"; input.identity.projectId = "changed"; input.identity.userId = "changed";
    input.identity.endpoint = "https://other.invalid"; input.model.id = "changed"; input.scope = "team";
    input.snapshot.cursor = "2"; input.assetId = "changed"; input.contentRevision = "b".repeat(64);
    return original();
  });
  await expect(f.controller.readSessionKnowledge(input)).resolves.toMatchObject({ snapshot, assetId: id, contentRevision });
  expect(f.messages[0]).toMatchObject({ scope: { teamId, scopeKind: "project", scopeId: projectId } });
});

it.each(["caller", "credential", "config", "shutdown", "suspend", "rebind"])("does not begin Main IO after %s during Agent admission", async action => {
  const f = fixture(true), pending = Promise.withResolvers<Response>(), original = f.fetcher.getMockImplementation()!;
  const response = await original("https://service.invalid/authorization");
  f.fetcher.mockImplementationOnce(() => pending.promise);
  const run = f.controller.readSessionKnowledge(sessionRead(f)), rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce()); await f.retire(action);
  pending.resolve(response); await rejected; expect(f.messages).toEqual([]);
});

it.each(["caller", "credential", "config", "shutdown", "suspend", "rebind"])("withholds a Session body after %s during the Main read", async action => {
  const f = fixture(true); let reading!: SharedKnowledgeReceiptRequest;
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => {
    f.messages.push(message); if (message.type === "shared-knowledge-index-read") reading = message; else f.reply(message);
  });
  const run = f.controller.readSessionKnowledge(sessionRead(f)), rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(reading).toBeDefined()); await f.retire(action); f.reply(reading); await rejected;
  expect(f.messages.at(-1)?.type).toBe("shared-knowledge-receipt-close");
});

it("does not renew the Agent grant when it expires at confirmed close", async () => {
  const f = fixture(true); vi.useFakeTimers({ toFake: ["Date"] }); const now = Date.now();
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementationOnce(async (...args) => {
    const data = await (await original(...args)).json() as Record<string, unknown>;
    return Response.json({ ...data, leaseExpiresAt: new Date(now + 20_000).toISOString() });
  });
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => {
    if (message.type === "shared-knowledge-receipt-close") vi.setSystemTime(now + 20_001);
    f.reply(message);
  });
  await expect(f.controller.readSessionKnowledge(sessionRead(f))).rejects.toThrow("unavailable");
  expect(f.fetcher).toHaveBeenCalledOnce();
});

it("counts pending Session authorization against the existing four slots until cancelled IO settles", async () => {
  const f = fixture(true), pending = Promise.withResolvers<Response>(), original = f.fetcher.getMockImplementation()!;
  const response = await original("https://service.invalid/authorization");
  f.fetcher.mockImplementation(() => pending.promise.then(value => value.clone()));
  const runs = Array.from({ length: 4 }, () => f.controller.readSessionKnowledge(sessionRead(f))), rejected = runs.map(run => expect(run).rejects.toThrow());
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(4)); await f.retire("config");
  await expect(f.controller.searchKnowledge(f.input)).rejects.toThrow();
  await expect(f.controller.readSessionKnowledge(sessionRead(f))).rejects.toThrow();
  expect(f.fetcher).toHaveBeenCalledTimes(4); expect(f.messages).toEqual([]);
  pending.resolve(response); await Promise.all(rejected);
  f.fetcher.mockImplementation(original);
  await expect(f.controller.readSessionKnowledge(sessionRead(f))).resolves.toMatchObject({ contentRevision });
});

it("cancels a stalled Main read when its shorter Agent lease expires", async () => {
  const f = fixture(true), original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementationOnce(async (...args) => {
    const data = await (await original(...args)).json() as Record<string, unknown>;
    return Response.json({ ...data, leaseExpiresAt: new Date(Date.now() + 1_000).toISOString() });
  });
  f.parent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => {
    f.messages.push(message); if (message.type !== "shared-knowledge-index-read") f.reply(message);
  });
  await expect(f.controller.readSessionKnowledge(sessionRead(f))).rejects.toThrow("unavailable");
  expect(f.messages.some(message => message.type === "shared-knowledge-index-read")).toBe(true);
  expect(f.messages.at(-1)?.type).toBe("shared-knowledge-receipt-close");
  expect(f.fetcher).toHaveBeenCalledOnce();
});
