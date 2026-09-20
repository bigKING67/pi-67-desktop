import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import { runSharedMemoryModelRequest } from "./shared-memory-model-request.js";

const input = { userId: "user", teamId: "team", projectId: null,
  purpose: "embedding" as const, model: { baseUrl: "https://models.invalid/v1", id: "fixture" } };
function authorization(purpose = "embedding") {
  return { userId: "user", teamId: "team", role: "member", permissionRevision: "a".repeat(64),
    issuedAt: new Date(Date.now() - 1000).toISOString(), leaseExpiresAt: new Date(Date.now() + 59_000).toISOString(),
    modelPolicy: { teamId: "team", revision: "1", allowedModels: [{ purpose, endpoint: input.model.baseUrl, modelId: input.model.id }] } };
}
function setup() {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(authorization())));
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, gateway: new EnterpriseContextGatewayClient("https://service.invalid", "synthetic-token") };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("authorizes each invocation independently and never sends model content through the authorization request", async () => {
  const { gateway, fetcher } = setup();
  const invoke = vi.fn(async () => "synthetic vector");
  for (let i = 0; i < 2; i++) expect(await runSharedMemoryModelRequest(gateway, input, invoke, new AbortController().signal)).toBe("synthetic vector");
  expect(fetcher).toHaveBeenCalledTimes(2); expect(invoke).toHaveBeenCalledTimes(2);
  for (const [, init] of fetcher.mock.calls) { expect(init?.body).toBeUndefined(); expect(init?.method).toBe("GET"); }
});

it.each(["agent", "extraction"])("does not let an %s rule authorize embedding", async (purpose) => {
  const { gateway, fetcher } = setup();
  fetcher.mockResolvedValue(new Response(JSON.stringify(authorization(purpose))));
  const invoke = vi.fn(async () => "must not run");
  await expect(runSharedMemoryModelRequest(gateway, input, invoke, new AbortController().signal)).rejects.toThrow("not authorized");
  expect(invoke).not.toHaveBeenCalled();
});

it("uses exact project authorization without falling back to team scope", async () => {
  const { gateway, fetcher } = setup();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...authorization("extraction"), projectId: "project" })));
  await runSharedMemoryModelRequest(gateway, { ...input, projectId: "project", purpose: "extraction" }, async () => 1, new AbortController().signal);
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://service.invalid/v1/agent/teams/team/projects/project/authorization");
  fetcher.mockResolvedValueOnce(new Response("{}", { status: 403 }));
  const invoke = vi.fn(async () => 1);
  await expect(runSharedMemoryModelRequest(gateway, { ...input, projectId: "project" }, invoke, new AbortController().signal)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not return a late result after identity cancellation", async () => {
  const { gateway } = setup(); const controller = new AbortController();
  await expect(runSharedMemoryModelRequest(gateway, input, async (model, signal) => {
    expect(Object.isFrozen(model)).toBe(true); controller.abort(); expect(signal.aborted).toBe(true); return "late";
  }, controller.signal)).rejects.toThrow();
});

it("rejects pre-cancellation and authorization network failure before invoking a model", async () => {
  const { gateway, fetcher } = setup(); const invoke = vi.fn(async () => 1);
  await expect(runSharedMemoryModelRequest(gateway, input, invoke, AbortSignal.abort())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRejectedValueOnce(new Error("synthetic network failure"));
  await expect(runSharedMemoryModelRequest(gateway, input, invoke, new AbortController().signal)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("ends the caller wait at lease expiry even if the native transport ignores cancellation", async () => {
  const { gateway, fetcher } = setup();
  const value = authorization();
  value.issuedAt = new Date().toISOString(); value.leaseExpiresAt = new Date(Date.now() + 80).toISOString();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(value)));
  let observed: AbortSignal | undefined;
  await expect(runSharedMemoryModelRequest(gateway, input, async (_model, signal) => {
    observed = signal; return new Promise<never>(() => undefined);
  }, new AbortController().signal)).rejects.toThrow();
  expect(observed?.aborted).toBe(true);
});

it("snapshots the selected model before waiting on authorization", async () => {
  const { gateway, fetcher } = setup();
  let resolve!: (value: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
  const mutable = { ...input, model: { ...input.model } };
  const invoke = vi.fn(async (model) => model.id);
  const result = runSharedMemoryModelRequest(gateway, mutable, invoke, new AbortController().signal);
  mutable.model.baseUrl = "https://other.invalid"; mutable.model.id = "other";
  resolve(new Response(JSON.stringify(authorization())));
  expect(await result).toBe("fixture");
  expect(invoke.mock.calls[0]?.[0]).toEqual(input.model);
});
