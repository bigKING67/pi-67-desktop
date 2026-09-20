import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import { verifySharedKnowledgeIndexHead, observeSharedKnowledgeIndexHead } from "./shared-knowledge-index-head.js";

const teamId = "00000000-0000-4000-8000-000000000001", epoch = "00000000-0000-4000-8000-000000000002", project = "00000000-0000-4000-8000-000000000003";
const models = { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } };
const address = (url: Parameters<typeof fetch>[0]) => typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture(projectId: string | null = null) {
  const input = { userId: "user", scope: { teamId, scopeKind: projectId === null ? "team" as const : "project" as const, scopeId: projectId ?? teamId },
    models: structuredClone(models), snapshot: { epoch, cursor: "9007199254740993" } };
  const grant = { userId: "user", teamId, ...(projectId === null ? {} : { projectId }), role: "member", permissionRevision: "a".repeat(64),
    issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    modelPolicy: { teamId, revision: "1", allowedModels: Object.entries(models).map(([purpose, model]) => ({ purpose, endpoint: model.endpoint, modelId: model.model })) } };
  const page = { ...input.scope, epoch, nextCursor: input.snapshot.cursor, headCursor: input.snapshot.cursor, hasMore: false, changes: [],
    permissionRevision: grant.permissionRevision, issuedAt: grant.issuedAt, leaseExpiresAt: grant.leaseExpiresAt };
  const fetcher = vi.fn<typeof fetch>(async url => Response.json(address(url).endsWith("/authorization") ? grant : page));
  vi.stubGlobal("fetch", fetcher);
  const gateway = new EnterpriseContextGatewayClient("https://service.invalid", "synthetic-service");
  const caller = new AbortController();
  return { input, grant, page, fetcher, gateway, caller, run: () => verifySharedKnowledgeIndexHead(gateway, input, caller.signal) };
}
it.each([null, project])("checks fresh exact scope and probes only the verified large cursor for %s", async projectId => {
  const f = fixture(projectId), assertValid = await f.run(); assertValid();
  const prefix = `https://service.invalid/v1/agent/teams/${teamId}${projectId === null ? "" : `/projects/${projectId}`}`;
  expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual([`${prefix}/authorization`, `${prefix}/shared-assets/sync?cursor=9007199254740993&limit=1&epoch=${epoch}`]);
  expect(f.fetcher.mock.calls.every(([, options]) => options?.method === "GET" && options.redirect === "error")).toBe(true);
});
it.each(["embedding", "extraction"])("rejects current %s policy denial before reading content", async purpose => {
  const f = fixture(); f.grant.modelPolicy.allowedModels = f.grant.modelPolicy.allowedModels.filter(rule => rule.purpose !== purpose);
  await expect(f.run()).rejects.toThrow("not current or authorized"); expect(f.fetcher).toHaveBeenCalledOnce();
});
it.each(["head", "epoch", "permission", "scope", "expired", "future", "malformed", "denied", "redirect"])("refuses %s without retry or publication", async mode => {
  const f = fixture();
  if (mode === "head") { f.page.headCursor = "9007199254740994"; f.page.hasMore = true; }
  if (mode === "epoch") f.page.epoch = project;
  if (mode === "permission") f.page.permissionRevision = "b".repeat(64);
  if (mode === "scope") f.page.scopeId = project;
  if (mode === "expired") { f.page.issuedAt = new Date(Date.now() - 70_000).toISOString(); f.page.leaseExpiresAt = new Date(Date.now() - 1_000).toISOString(); }
  if (mode === "future") { f.page.issuedAt = new Date(Date.now() + 60_000).toISOString(); f.page.leaseExpiresAt = new Date(Date.now() + 120_000).toISOString(); }
  if (mode === "malformed") f.fetcher.mockResolvedValueOnce(Response.json({ secret: "synthetic" }));
  if (mode === "denied") f.fetcher.mockResolvedValueOnce(Response.json({}, { status: 403 }));
  if (mode === "redirect") f.fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://other.invalid" } }));
  await expect(f.run()).rejects.toThrow("not current or authorized"); expect(f.fetcher.mock.calls.length).toBeLessThanOrEqual(2);
});
it("captures scope/model/cursor before awaiting and checks the shorter page lease across cleanup", async () => {
  vi.useFakeTimers(); const f = fixture(); f.page.leaseExpiresAt = new Date(Date.now() + 1_000).toISOString();
  let release!: (response: Response) => void;
  f.fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const run = f.run();
  f.input.snapshot.cursor = "2"; f.input.models.embedding.model = "changed"; f.input.scope.scopeId = project;
  release(Response.json(f.grant)); const assertValid = await run; assertValid();
  vi.advanceTimersByTime(1_001); expect(assertValid).toThrow("expired");
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it.each(["authorization", "head"])("discards a late %s response on cancellation", async phase => {
  const f = fixture(); let release!: (response: Response) => void;
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation((url, options) => {
    if (address(url).endsWith("/authorization") === (phase === "authorization")) return new Promise(resolve => { release = resolve; });
    return original(url, options);
  });
  const run = f.run(), rejected = expect(run).rejects.toThrow("not current or authorized");
  await vi.waitFor(() => expect(release).toBeTypeOf("function")); f.caller.abort();
  release(Response.json(phase === "authorization" ? f.grant : f.page)); await rejected;
  expect(f.fetcher.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
});
it("makes no request for a pre-cancelled caller", async () => {
  const f = fixture(); f.caller.abort(); await expect(f.run()).rejects.toThrow("not current or authorized"); expect(f.fetcher).not.toHaveBeenCalled();
});
it.each(["completed", "authorization-failed", "head-probe-failed", "revision-changed", "timeout", "cancelled"] as const)("records only bounded phase metadata for %s", async outcome => {
  const f = fixture(), report = vi.fn();
  if (outcome === "authorization-failed") f.fetcher.mockRejectedValueOnce(new Error("private secret"));
  if (outcome === "head-probe-failed") f.fetcher.mockResolvedValueOnce(Response.json(f.grant)).mockRejectedValueOnce(new Error("private body"));
  if (outcome === "revision-changed") {
    const changed = { ...f.page, nextCursor: "9007199254740994", headCursor: "9007199254740994",
      changes: [{ cursor: "9007199254740994", assetId: teamId, operation: "revoke", contentRevision: "b".repeat(64) }] };
    f.fetcher.mockImplementation(async url => Response.json(address(url).endsWith("/authorization") ? f.grant : changed));
  }
  if (outcome === "timeout") f.caller.abort(new DOMException("private reason", "TimeoutError"));
  if (outcome === "cancelled") f.caller.abort();
  const result = observeSharedKnowledgeIndexHead(f.gateway, f.input, f.caller.signal, report);
  if (outcome === "completed") (await result).assertValid(); else await expect(result).rejects.toThrow("not current or authorized");
  expect(report).toHaveBeenCalledOnce();
  const diagnostic = report.mock.calls[0]![0];
  expect(diagnostic).toEqual({ schema: "new-money.team-head.v1", outcome, durationMs: expect.any(Number),
    stages: expect.any(Array) });
  const expectedStages = outcome === "completed" || outcome === "revision-changed" ? ["authorization", "head-probe", "validation"]
    : outcome === "head-probe-failed" ? ["authorization", "head-probe"] : ["authorization"];
  expect(diagnostic.stages).toEqual(expectedStages.map(stage => ({ stage, durationMs: expect.any(Number) })));
  expect(JSON.stringify(diagnostic)).not.toMatch(/private|service.invalid|model.invalid|9007199254740994|user/);
});
it("does not let a failing diagnostic sink change authorization", async () => {
  const f = fixture();
  (await observeSharedKnowledgeIndexHead(f.gateway, f.input, f.caller.signal, () => { throw new Error("sink failed"); })).assertValid();
});
it("rejects a valid newer revocation page instead of indexing or persisting it", async () => {
  const f = fixture();
  const changed = { ...f.page, nextCursor: "9007199254740994", headCursor: "9007199254740994",
    changes: [{ cursor: "9007199254740994", assetId: teamId, operation: "revoke", contentRevision: "b".repeat(64) }] };
  f.fetcher.mockImplementation(async url => Response.json(address(url).endsWith("/authorization") ? f.grant : changed));
  await expect(f.run()).rejects.toThrow("not current or authorized"); expect(f.fetcher).toHaveBeenCalledTimes(2);
});
