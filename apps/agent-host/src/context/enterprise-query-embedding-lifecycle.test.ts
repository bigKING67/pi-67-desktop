import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseContextController } from "./enterprise-context-controller.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";
import { createTeamQueryEmbedding, type TeamQueryEmbedding } from "./team-query-embedding.js";

const embedding = { protocol: "openai-compatible" as const, endpoint: "https://embed.invalid/v1", model: "embed", dimension: 4, apiKey: "synthetic-key" };
const controllers: EnterpriseContextController[] = [];
function isAuthorization(url: Parameters<typeof fetch>[0]): boolean {
  return (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith("/authorization");
}
afterEach(() => { for (const controller of controllers.splice(0)) controller.shutdown(); vi.unstubAllGlobals(); enterprisePowerEpoch.transition("resume"); });
function fixture() {
  const credential = { endpoint: "https://service.invalid", accessToken: "synthetic-token", userId: "user", accountId: "team", expiresAt: Date.now() + 600_000 };
  const broker = new EnterpriseCredentialBrokerClient({ postMessage: vi.fn() });
  const bootstrap = () => broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential }); bootstrap();
  const configuration = { read: vi.fn(async () => ({ enterpriseGatewayEndpoint: credential.endpoint })) };
  const controller = new EnterpriseContextController(configuration as never, { require() { throw new Error("Synthetic rebind stopped"); } } as never, { sendFor() {} } as never, broker);
  controllers.push(controller);
  const caller = new AbortController(), loadEmbedding = vi.fn(async (signal: AbortSignal) => createTeamQueryEmbedding(embedding, signal));
  const input = { teamId: "team", projectId: null, workspaceId: "workspace", query: "synthetic-query",
    expectedModel: { endpoint: embedding.endpoint, model: "embed", dimension: 4 }, signal: caller.signal, loadEmbedding };
  const grant = { userId: "user", teamId: "team", role: "member", permissionRevision: "a".repeat(64), issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    modelPolicy: { teamId: "team", revision: "1", allowedModels: [{ purpose: "embedding", endpoint: embedding.endpoint, modelId: "embed" }] } };
  const fetcher = vi.fn<typeof fetch>(async url => isAuthorization(url) ? Response.json(grant) : Response.json({ model: "embed", data: [{ index: 0, embedding: [1, 2, 3, 4] }] }));
  vi.stubGlobal("fetch", fetcher);
  const retire = async (action: string) => {
    if (action === "caller") caller.abort();
    if (action === "credential") bootstrap();
    if (action === "config") controller.retireTeamModelChannels();
    if (action === "shutdown") controller.shutdown();
    if (action === "suspend") enterprisePowerEpoch.transition("suspend");
    if (action === "rebind") await controller.bindWorkspace("workspace", "team", "next", "fixture").catch(() => undefined);
  };
  return { credential, broker, configuration, controller, caller, loadEmbedding, input, fetcher, retire };
}
it.each(["caller", "credential", "config", "shutdown", "suspend", "rebind"])("retires late query configuration on %s before any model call", async action => {
  const f = fixture(); let release!: (source: TeamQueryEmbedding) => void;
  f.loadEmbedding.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const run = f.controller.embedKnowledgeQuery(f.input), rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(f.loadEmbedding).toHaveBeenCalledOnce()); await f.retire(action);
  expect(f.loadEmbedding.mock.calls[0]![0].aborted).toBe(true);
  release(createTeamQueryEmbedding(embedding, new AbortController().signal)); await rejected;
  expect(f.fetcher).not.toHaveBeenCalled();
});
it.each(["caller", "credential", "config", "shutdown", "suspend", "rebind"])("rejects an already submitted vector on %s and waits for transport settlement", async action => {
  const f = fixture(); let release!: (response: Response) => void;
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation((url, init) => isAuthorization(url) ? original(url, init) : new Promise(resolve => { release = resolve; }));
  let settled = false;
  const run = f.controller.embedKnowledgeQuery(f.input).finally(() => { settled = true; }), rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2)); await f.retire(action);
  await new Promise(resolve => setTimeout(resolve, 10)); expect(settled).toBe(false);
  expect(f.fetcher.mock.calls[1]![1]!.signal!.aborted).toBe(true);
  release(Response.json({ model: "embed", data: [{ index: 0, embedding: [1, 2, 3, 4] }] })); await rejected;
});
it.each([{ endpoint: "https://other.invalid" }, { model: "other" }, { dimension: 8 }])("rejects captured index model mismatch before authorization or paid request %#", async changed => {
  const f = fixture();
  await expect(f.controller.embedKnowledgeQuery({ ...f.input, expectedModel: { ...f.input.expectedModel, ...changed } })).rejects.toThrow("unavailable");
  expect(f.fetcher).not.toHaveBeenCalled();
});
it("holds all four query slots while cancelled model transports remain unsettled", async () => {
  const f = fixture(), releases: Array<(response: Response) => void> = [], original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation((url, init) => isAuthorization(url) ? original(url, init) : new Promise(resolve => { releases.push(resolve); }));
  const runs = Array.from({ length: 4 }, () => f.controller.embedKnowledgeQuery(f.input)), rejected = runs.map(run => expect(run).rejects.toThrow());
  await vi.waitFor(() => expect(releases).toHaveLength(4)); f.caller.abort();
  await expect(f.controller.embedKnowledgeQuery({ ...f.input, signal: new AbortController().signal })).rejects.toThrow();
  expect(f.loadEmbedding).toHaveBeenCalledTimes(4);
  for (const release of releases) release(Response.json({})); await Promise.all(rejected);
  f.fetcher.mockImplementation(original);
  await expect(f.controller.embedKnowledgeQuery({ ...f.input, signal: new AbortController().signal })).resolves.toMatchObject({ vector: [1, 2, 3, 4], model: f.input.expectedModel });
});
it("captures query and expected index selection before asynchronous source loading", async () => {
  const f = fixture(); let release!: (source: TeamQueryEmbedding) => void;
  f.loadEmbedding.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const run = f.controller.embedKnowledgeQuery(f.input);
  f.input.query = "mutated"; f.input.expectedModel.model = "mutated";
  await vi.waitFor(() => expect(f.loadEmbedding).toHaveBeenCalledOnce());
  release(createTeamQueryEmbedding(embedding, f.loadEmbedding.mock.calls[0]![0]));
  expect((await run).model.model).toBe("embed");
  expect(JSON.parse(Buffer.from(f.fetcher.mock.calls[1]![1]!.body as Uint8Array).toString()).input).toEqual(["synthetic-query"]);
});
it("does not load model settings for a signed-out identity or invalid query", async () => {
  const f = fixture();
  await expect(f.controller.embedKnowledgeQuery({ ...f.input, query: "" })).rejects.toThrow();
  f.broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available" });
  await expect(f.controller.embedKnowledgeQuery(f.input)).rejects.toThrow();
  expect(f.loadEmbedding).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
});
