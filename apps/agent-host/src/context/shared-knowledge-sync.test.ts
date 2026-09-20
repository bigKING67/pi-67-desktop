import { afterEach, expect, it, vi } from "vitest";
import { syncSharedKnowledge } from "./shared-knowledge-sync.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";

afterEach(() => { enterprisePowerEpoch.transition("resume"); });

const id = "00000000-0000-0000-0000-000000000001";
const revision = "a".repeat(64);
function fixture() {
  const grant = { permissionRevision: revision, deadline: Date.now() + 300_000, assertValid: vi.fn(), assertModel: vi.fn(), assertAgentModel: vi.fn() };
  const wire = '\uFEFF { "original": true } \n';
  const gateway = { authorizeTeam: vi.fn(async () => grant), authorizeProject: vi.fn(async () => grant),
    syncKnowledge: vi.fn(async () => ({ bytes: new TextEncoder().encode(wire), page: {
      teamId: id, scopeKind: "team" as const, scopeId: id, epoch: id, nextCursor: "1", headCursor: "1",
      hasMore: false, issuedAt: 0, leaseExpiresAt: 1, permissionRevision: revision, changes: []
    } })) };
  type Request = Parameters<Parameters<typeof syncSharedKnowledge>[0]["receipts"]["request"]>[0];
  const request = vi.fn<Parameters<typeof syncSharedKnowledge>[0]["receipts"]["request"]>(async (input: Request) => {
    if (input.type === "shared-knowledge-receipt-open") return { type: "shared-knowledge-receipt-open-result", requestId: id,
      ok: true, handleId: id, userId: "user", endpoint: "https://example.com", progress: { epoch: null, cursor: "0" } };
    if (input.type === "shared-knowledge-receipt-append") return { type: "shared-knowledge-receipt-append-result", requestId: id,
      ok: true, progress: { epoch: id, cursor: "1" } };
    return { type: "shared-knowledge-receipt-close-result", requestId: id, ok: true };
  });
  const controller = new AbortController();
  const lifetime = new AbortController();
  const options = { gateway, receipts: { request, signal: lifetime.signal }, userId: "user", scope: { teamId: id, scopeKind: "team" as "team" | "project", scopeId: id },
    assertCurrent: vi.fn(), signal: controller.signal, maxPages: 2 };
  return { options, gateway, request, controller, lifetime, grant, wire };
}

it("authorizes exact scope and forwards original bytes before returning acknowledged progress", async () => {
  const f = fixture();
  expect(await syncSharedKnowledge(f.options)).toEqual({ progress: { epoch: id, cursor: "1" }, pages: 1, headCursor: "1" });
  expect(f.gateway.authorizeTeam).toHaveBeenCalledWith("user", id, expect.any(AbortSignal));
  expect(f.gateway.authorizeProject).not.toHaveBeenCalled();
  expect(f.request.mock.calls[1]?.[0]).toMatchObject({ type: "shared-knowledge-receipt-append", pageJson: f.wire, fromCursor: "0" });
  expect(f.request.mock.calls[2]?.[0].type).toBe("shared-knowledge-receipt-close");
});
it("uses project authorization without a team fallback", async () => {
  const f = fixture(); f.options.scope.scopeKind = "project";
  f.gateway.authorizeProject.mockRejectedValue(new Error("denied"));
  await expect(syncSharedKnowledge(f.options)).rejects.toThrow("denied");
  expect(f.gateway.authorizeTeam).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});
it("cancels stalled page transport when its credential client is retired", async () => {
  const f = fixture();
  f.gateway.syncKnowledge.mockImplementation(() => new Promise((_resolve, reject) => {
    const signal = f.request.mock.calls[0]?.[1];
    if (!signal) throw new Error("Missing combined cancellation signal");
    signal.addEventListener("abort", () => reject(new Error("retired transport")), { once: true });
  }));
  const pending = syncSharedKnowledge(f.options);
  const assertion = expect(pending).rejects.toThrow("retired transport");
  await vi.waitFor(() => expect(f.gateway.syncKnowledge).toHaveBeenCalledOnce());
  f.lifetime.abort();
  await assertion;
  expect(f.controller.signal.aborted).toBe(false);
  expect(f.request.mock.calls.map(([input]) => input.type)).toEqual(["shared-knowledge-receipt-open", "shared-knowledge-receipt-close"]);
  expect(f.request.mock.calls.at(-1)?.[1]).toBeUndefined();
});
it("does not authorize or fetch for an already retired credential client", async () => {
  const f = fixture(); f.lifetime.abort();
  await expect(syncSharedKnowledge(f.options)).rejects.toThrow();
  expect(f.gateway.authorizeTeam).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalled();
});

it("actively cancels stalled sync on power transition and requires a fresh run after wake", async () => {
  const f = fixture();
  f.gateway.syncKnowledge.mockImplementation(() => new Promise((_resolve, reject) => {
    const signal = f.request.mock.calls[0]?.[1];
    if (!signal) throw new Error("Missing cancellation signal");
    signal.addEventListener("abort", () => reject(new Error("power cancelled")), { once: true });
  }));
  const pending = syncSharedKnowledge(f.options);
  const assertion = expect(pending).rejects.toThrow("power cancelled");
  await vi.waitFor(() => expect(f.gateway.syncKnowledge).toHaveBeenCalledOnce());
  enterprisePowerEpoch.transition("suspend");
  await assertion;
  expect(f.request.mock.calls.at(-1)?.[0].type).toBe("shared-knowledge-receipt-close");
  expect(f.controller.signal.aborted).toBe(false);
  expect(f.lifetime.signal.aborted).toBe(false);
  const next = fixture();
  await expect(syncSharedKnowledge(next.options)).rejects.toThrow("power transition");
  expect(next.gateway.authorizeTeam).not.toHaveBeenCalled();
  enterprisePowerEpoch.transition("resume");
  await expect(syncSharedKnowledge(next.options)).resolves.toHaveProperty("pages", 1);
  expect(next.gateway.authorizeTeam).toHaveBeenCalledOnce();
});
it("resumes each next page from the acknowledged cursor and epoch", async () => {
  const f = fixture(); const response = await f.gateway.syncKnowledge();
  f.gateway.syncKnowledge.mockClear().mockResolvedValueOnce({ ...response, page: { ...response.page, hasMore: true, headCursor: "2" } })
    .mockResolvedValueOnce({ ...response, page: { ...response.page, nextCursor: "2", headCursor: "2" } });
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation((input, signal) => input.type === "shared-knowledge-receipt-append" && input.fromCursor === "1"
    ? Promise.resolve({ type: "shared-knowledge-receipt-append-result", requestId: id, ok: true, progress: { epoch: id, cursor: "2" } })
    : original(input, signal));
  expect(await syncSharedKnowledge(f.options)).toEqual({ progress: { epoch: id, cursor: "2" }, pages: 2, headCursor: "2" });
  expect(f.gateway.syncKnowledge.mock.calls[1]).toEqual([{ ...f.options.scope, cursor: "1", epoch: id, permissionRevision: revision, limit: 50 }, expect.any(AbortSignal)]);
});
it("fences identity changes during open and still closes the returned handle", async () => {
  const f = fixture(); const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input, signal) => {
    const result = await original(input, signal);
    if (input.type === "shared-knowledge-receipt-open") f.options.assertCurrent.mockImplementation(() => { throw new Error("retired identity"); });
    return result;
  });
  await expect(syncSharedKnowledge(f.options)).rejects.toThrow("retired identity");
  expect(f.gateway.syncKnowledge).not.toHaveBeenCalled();
  expect(f.request.mock.calls.at(-1)?.[0].type).toBe("shared-knowledge-receipt-close");
});
it("reports cleanup failure after success but preserves an earlier persistence failure", async () => {
  for (const appendFails of [false, true]) {
    const f = fixture(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation((input, signal) => {
      if (input.type === "shared-knowledge-receipt-close") return Promise.reject(new Error("channel closed"));
      if (appendFails && input.type === "shared-knowledge-receipt-append") return Promise.reject(new Error("disk failed"));
      return original(input, signal);
    });
    await expect(syncSharedKnowledge(f.options)).rejects.toThrow(appendFails ? "disk failed" : "channel closed");
  }
});
it("does not fetch when Main refuses the scope", async () => {
  const f = fixture(); f.request.mockResolvedValueOnce({ type: "shared-knowledge-receipt-open-result", requestId: id, ok: false, errorCode: "SCOPE_DENIED" });
  await expect(syncSharedKnowledge(f.options)).rejects.toThrow("SCOPE_DENIED");
  expect(f.gateway.syncKnowledge).not.toHaveBeenCalled();
});
it("does not fetch the next page before append acknowledgement", async () => {
  const f = fixture();
  const response = await f.gateway.syncKnowledge(); response.page.hasMore = true; response.page.headCursor = "2";
  f.gateway.syncKnowledge.mockClear().mockResolvedValue(response);
  const original = f.request.getMockImplementation()!;
  let deny!: () => void;
  f.request.mockImplementation((input, signal) => input.type === "shared-knowledge-receipt-append"
    ? new Promise((resolve) => { deny = () => resolve({ type: "shared-knowledge-receipt-append-result", requestId: id, ok: false, errorCode: "PERSISTENCE_FAILED" }); })
    : original(input, signal));
  const pending = syncSharedKnowledge(f.options);
  const assertion = expect(pending).rejects.toThrow("PERSISTENCE_FAILED");
  await vi.waitFor(() => expect(deny).toBeDefined());
  expect(f.gateway.syncKnowledge).toHaveBeenCalledOnce(); deny(); await assertion;
  expect(f.gateway.syncKnowledge).toHaveBeenCalledOnce();
});
it("closes after cancellation during fetch without appending", async () => {
  const f = fixture(); const response = await f.gateway.syncKnowledge();
  f.gateway.syncKnowledge.mockImplementation(async () => { f.controller.abort(); return response; });
  await expect(syncSharedKnowledge(f.options)).rejects.toThrow();
  expect(f.request.mock.calls.map(([input]) => input.type)).toEqual(["shared-knowledge-receipt-open", "shared-knowledge-receipt-close"]);
  expect(f.request.mock.calls[1]?.[1]).toBeUndefined();
});
it("rejects stale grants and mismatched acknowledgements without reporting success", async () => {
  for (const stale of [false, true]) {
    const f = fixture(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (input, signal) => {
      const result = await original(input, signal);
      if (input.type === "shared-knowledge-receipt-append") {
        if (stale) f.grant.assertValid.mockImplementation(() => { throw new Error("expired"); });
        else return { type: "shared-knowledge-receipt-append-result", requestId: id, ok: true, progress: { epoch: id, cursor: "2" } };
      }
      return result;
    });
    await expect(syncSharedKnowledge(f.options)).rejects.toThrow(stale ? "expired" : "progress mismatch");
    expect(f.request.mock.calls.at(-1)?.[0].type).toBe("shared-knowledge-receipt-close");
  }
});
it("bounds catch-up pages and rejects invalid budgets before any work", async () => {
  const f = fixture(); f.options.maxPages = 1;
  const response = await f.gateway.syncKnowledge(); response.page.hasMore = true; response.page.headCursor = "2";
  f.gateway.syncKnowledge.mockClear().mockResolvedValue(response);
  await expect(syncSharedKnowledge(f.options)).rejects.toThrow("budget exhausted");
  expect(f.gateway.syncKnowledge).toHaveBeenCalledOnce();
  f.options.maxPages = 101; f.gateway.authorizeTeam.mockClear();
  await expect(syncSharedKnowledge(f.options)).rejects.toThrow("Invalid shared sync page budget");
  expect(f.gateway.authorizeTeam).not.toHaveBeenCalled();
});
