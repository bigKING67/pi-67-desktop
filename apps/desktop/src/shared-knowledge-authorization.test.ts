import { afterEach, expect, it, vi } from "vitest";
import { authorizeSharedKnowledge } from "./shared-knowledge-authorization.js";

const id = "00000000-0000-4000-8000-000000000001";
const scope = { teamId: id, scopeKind: "team" as const, scopeId: id };
const identity = { endpoint: "https://example.com/base/", userId: id };
function fixture() {
  const now = Date.now();
  const credential = { ...identity, accountId: id, accessToken: "synthetic-test-token", expiresAt: now + 600_000 };
  const value = { userId: id, teamId: id, role: "member", permissionRevision: "a".repeat(64),
    issuedAt: new Date(now).toISOString(), leaseExpiresAt: new Date(now + 300_000).toISOString(), modelPolicy: { allowedModels: [] } };
  const store = { load: vi.fn(async () => ({ storage: "available" as const, credential })), store: vi.fn(), clear: vi.fn() };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  return { credential, value, store, fetcher, controller,
    run: () => authorizeSharedKnowledge(store, scope, identity, controller.signal) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("uses only exact read-only authorization with secure-store credentials, no refresh or model grant", async () => {
  const f = fixture(); const grant = await f.run();
  expect(f.fetcher.mock.calls[0]).toEqual([`https://example.com/base/v1/agent/teams/${id}/authorization`, {
    method: "GET", redirect: "error", cache: "no-store", signal: f.controller.signal,
    headers: { Accept: "application/json", Authorization: "Bearer synthetic-test-token" }
  }]);
  expect(grant?.permissionRevision).toBe(f.value.permissionRevision);
  expect(grant).not.toHaveProperty("assertAgentModel");
  expect(() => grant?.assertValid()).not.toThrow();
  expect(f.store.store).not.toHaveBeenCalled();
});
it("requires an exact project grant even for administrators", async () => {
  const f = fixture(); f.value.role = "admin";
  await expect(authorizeSharedKnowledge(f.store, { ...scope, scopeKind: "project" }, identity, f.controller.signal)).rejects.toThrow();
  f.fetcher.mockResolvedValue(new Response(JSON.stringify({ ...f.value, projectId: id }), { headers: { "content-type": "application/json" } }));
  await expect(authorizeSharedKnowledge(f.store, { ...scope, scopeKind: "project" }, identity, f.controller.signal)).resolves.toHaveProperty("permissionRevision");
  expect(f.fetcher.mock.calls.at(-1)?.[0]).toBe(`https://example.com/base/v1/agent/teams/${id}/projects/${id}/authorization`);
});
it("rejects identity drift, expired credentials and non-HTTPS endpoints before transport", async () => {
  for (const change of ["identity", "expiry", "endpoint"] as const) {
    const f = fixture();
    if (change === "identity") f.credential.userId = "different";
    if (change === "expiry") f.credential.expiresAt = Date.now() - 1;
    if (change === "endpoint") f.credential.endpoint = "http://example.com";
    await expect(f.run()).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
  }
});
it("does not retry redirects or denials and redacts transport failures", async () => {
  for (const status of [302, 401, 403, 500]) {
    const f = fixture(); f.fetcher.mockResolvedValue(new Response(null, { status }));
    if (status === 401 || status === 403) await expect(f.run()).resolves.toBeUndefined();
    else await expect(f.run()).rejects.toThrow("Shared knowledge authorization unavailable.");
    expect(f.fetcher).toHaveBeenCalledOnce();
  }
  const f = fixture(); f.fetcher.mockRejectedValue(new Error("synthetic-secret-should-not-escape"));
  await expect(f.run()).rejects.toThrow(/^Shared knowledge authorization unavailable\.$/u);
});
it("rejects response scope confusion and malformed or excessive leases", async () => {
  for (const patch of [{ userId: "other" }, { projectId: id }, { teamId: "other" }, { permissionRevision: "bad" },
    { issuedAt: "not a date" }, { leaseExpiresAt: new Date(Date.now() + 900_000).toISOString() }]) {
    const f = fixture(); f.fetcher.mockResolvedValue(new Response(JSON.stringify({ ...f.value, ...patch }), { headers: { "content-type": "application/json" } }));
    await expect(f.run()).rejects.toThrow();
  }
});
it("bounds streamed bytes rather than trusting Content-Length", async () => {
  const f = fixture(), cancel = vi.fn();
  f.fetcher.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(128 * 1024 + 1));
  }, cancel }), { headers: { "content-type": "application/json", "content-length": "1" } }));
  await expect(f.run()).rejects.toThrow(); expect(cancel).toHaveBeenCalledOnce();
});
it("cancels stalled body reads and never fetches for a pre-aborted request", async () => {
  const f = fixture(), cancel = vi.fn();
  f.fetcher.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }));
  const pending = f.run(); await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
  f.controller.abort(); await expect(pending).rejects.toThrow(); expect(cancel).toHaveBeenCalledOnce();
  await expect(f.run()).rejects.toThrow(); expect(f.fetcher).toHaveBeenCalledOnce();
});
it("expires irreversibly on wall-clock rollback or credential expiry", async () => {
  vi.useFakeTimers();
  const f = fixture(); f.credential.expiresAt = Date.now() + 1_000;
  const grant = await f.run(); const now = Date.now();
  if (!grant) throw new Error("Expected grant");
  vi.setSystemTime(now - 1); expect(() => grant.assertValid()).toThrow();
  vi.setSystemTime(now); expect(() => grant.assertValid()).toThrow();
  const fresh = await f.run(); if (!fresh) throw new Error("Expected grant");
  vi.setSystemTime(now + 1_001); expect(() => fresh.assertValid()).toThrow();
});
