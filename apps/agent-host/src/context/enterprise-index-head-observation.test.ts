import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { SharedKnowledgeIndexHeadCheck } from "@pi67/protocol";
import { EnterpriseAuthorizationController } from "./enterprise-authorization-controller.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); enterprisePowerEpoch.transition("resume"); });
function fixture(project = false) {
  const teamId = randomUUID(), scopeId = project ? randomUUID() : teamId;
  const credential = { endpoint: "https://service.invalid", accessToken: "synthetic-token", userId: "user", accountId: teamId, expiresAt: Date.now() + 600_000 };
  const broker = new EnterpriseCredentialBrokerClient({ postMessage() {} });
  const bootstrap = () => broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential }); bootstrap();
  const configuration = { read: vi.fn(async () => ({ enterpriseGatewayEndpoint: credential.endpoint })) };
  const controller = new EnterpriseAuthorizationController(configuration as never, { sendFor() {} } as never, broker);
  const input: SharedKnowledgeIndexHeadCheck = { type: "team-index-head-check", requestId: randomUUID(),
    owner: { userId: "user", endpoint: credential.endpoint, teamId, scopeKind: project ? "project" : "team", scopeId },
    models: { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } },
    snapshot: { epoch: randomUUID(), cursor: "7" }, permissionRevision: "a".repeat(64) };
  const grant = { userId: "user", teamId, ...(project ? { projectId: scopeId } : {}), role: "member", permissionRevision: input.permissionRevision,
    issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    modelPolicy: { teamId, revision: "1", allowedModels: Object.entries(input.models).map(([purpose, model]) => ({ purpose, endpoint: model.endpoint, modelId: model.model })) } };
  const page = { teamId, scopeKind: input.owner.scopeKind, scopeId, ...input.snapshot, nextCursor: "7", headCursor: "7", changes: [], hasMore: false,
    issuedAt: grant.issuedAt, leaseExpiresAt: grant.leaseExpiresAt, permissionRevision: grant.permissionRevision };
  Reflect.deleteProperty(page, "cursor");
  const fetcher = vi.fn<typeof fetch>(async url => {
    const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    return Response.json(address.endsWith("/authorization") ? grant : page);
  });
  vi.stubGlobal("fetch", fetcher);
  const caller = new AbortController(), run = () => controller.observeIndexHead(input, caller.signal);
  return { input, credential, broker, bootstrap, controller, configuration, grant, page, fetcher, caller, run };
}
it.each([false, true])("observes exact Main scope/revision/head via the real Gateway (project=%s)", async project => {
  const f = fixture(project); f.page.leaseExpiresAt = new Date(Date.now() + 40_000).toISOString();
  try {
    const lease = await f.run(); lease.assertValid();
    expect(lease.validUntil).toBe(Date.parse(f.page.leaseExpiresAt));
    const prefix = `${f.credential.endpoint}/v1/agent/teams/${f.input.owner.teamId}${project ? `/projects/${f.input.owner.scopeId}` : ""}`;
    expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual([`${prefix}/authorization`, `${prefix}/shared-assets/sync?cursor=7&limit=1&epoch=${f.input.snapshot.epoch}`]);
    expect(f.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    lease.release(); expect(lease.signal.aborted).toBe(true); expect(lease.assertValid).toThrow();
  } finally { f.controller.shutdown(); }
});
it.each(["user", "endpoint", "configuration", "missing-credential", "pre-abort"])("rejects %s before HTTP", async mode => {
  const f = fixture();
  try {
    if (mode === "user") f.input.owner.userId = "other";
    if (mode === "endpoint") f.input.owner.endpoint = "https://other.invalid";
    if (mode === "configuration") f.configuration.read.mockResolvedValue({ enterpriseGatewayEndpoint: "https://other.invalid" });
    if (mode === "missing-credential") f.broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available" });
    if (mode === "pre-abort") f.caller.abort();
    await expect(f.run()).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
  } finally { f.controller.shutdown(); }
});
it.each(["permission-revision", "model", "head", "denial"])("refuses a changed %s without exposing HTTP payloads", async mode => {
  const f = fixture();
  try {
    if (mode === "permission-revision") f.input.permissionRevision = "b".repeat(64);
    if (mode === "model") f.grant.modelPolicy.allowedModels.pop();
    if (mode === "head") f.page.headCursor = "8";
    if (mode === "denial") f.fetcher.mockResolvedValueOnce(Response.json({ secret: "synthetic" }, { status: 403 }));
    await expect(f.run()).rejects.toThrow("not current or authorized");
    expect(f.fetcher).toHaveBeenCalledTimes(mode === "head" ? 2 : 1);
  } finally { f.controller.shutdown(); }
});
it.each(["caller", "bootstrap", "config", "workspace-config", "shutdown", "suspend"])("revokes a successful observation on %s", async mode => {
  const f = fixture();
  try {
    const lease = await f.run();
    if (mode === "caller") f.caller.abort();
    if (mode === "bootstrap") f.bootstrap();
    if (mode === "config") f.controller.retireTeamModelChannels();
    if (mode === "workspace-config") f.controller.retireTeamModelChannels("different-workspace");
    if (mode === "shutdown") f.controller.shutdown();
    if (mode === "suspend") enterprisePowerEpoch.transition("suspend");
    expect(lease.signal.aborted).toBe(true); expect(lease.assertValid).toThrow(); lease.release();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  } finally { f.controller.shutdown(); }
});
it("captures Main input before pending configuration IO and holds all four cancelled slots until settlement", async () => {
  const f = fixture(); let finish!: (value: { enterpriseGatewayEndpoint: string }) => void;
  f.configuration.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  try {
    const pending = f.run(); const rejected = expect(pending).rejects.toThrow();
    f.input.owner.userId = "changed"; f.caller.abort(); finish({ enterpriseGatewayEndpoint: f.credential.endpoint }); await rejected;
    expect(f.fetcher).not.toHaveBeenCalled();
    const finishes: typeof finish[] = [];
    f.configuration.read.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
    const caller = new AbortController();
    const runs = Array.from({ length: 4 }, () => f.controller.observeIndexHead(f.input, caller.signal).catch(() => undefined));
    caller.abort(); await expect(f.controller.observeIndexHead(f.input, new AbortController().signal)).rejects.toThrow();
    expect(finishes).toHaveLength(4); for (const resolve of finishes) resolve({ enterpriseGatewayEndpoint: f.credential.endpoint });
    await Promise.all(runs);
  } finally { f.controller.shutdown(); }
});
it("keeps returned observations beyond the request-only timeout but enforces credential expiry", async () => {
  vi.useFakeTimers(); const f = fixture(); f.credential.expiresAt = Date.now() + 40_000; f.bootstrap();
  try {
    const lease = await f.run(); expect(lease.validUntil).toBe(f.credential.expiresAt);
    await vi.advanceTimersByTimeAsync(8_001); lease.assertValid();
    vi.advanceTimersByTime(32_000); expect(lease.assertValid).toThrow(); lease.release();
  } finally { f.controller.shutdown(); }
});
