import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseAuthorizationController } from "./enterprise-authorization-controller.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";

const endpoint = "https://fixture.invalid";
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const configuration = { enterpriseGatewayEndpoint: endpoint };
  const operations: string[] = [];
  const broker = new EnterpriseCredentialBrokerClient({ postMessage(message) {
    operations.push(message.type);
    queueMicrotask(() => broker.handleOperationResult({ type: "enterprise-credential-operation-result",
      requestId: message.requestId, ok: true }));
  } });
  broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential: {
    endpoint, accountId: "team", userId: "user", displayName: "Old name",
    accessToken: "synthetic", expiresAt: Date.now() + 60_000
  } });
  const controller = new EnterpriseAuthorizationController({ read: async () => configuration } as never,
    { sendFor() {} } as never, broker);
  return { configuration, broker, controller, operations };
}
it("refreshes the name without replacing credentials or retiring team work; passive reads stay local", async () => {
  const f = fixture();
  const fetch = vi.fn(async () => Response.json({ user: { id: "user", displayName: "whois67" } }));
  vi.stubGlobal("fetch", fetch);
  try {
    expect(f.controller.currentIdentity()).toMatchObject({ displayName: "Old name" });
    expect(fetch).not.toHaveBeenCalled();
    const lifetime = f.broker.signal;
    expect(await f.controller.refreshIdentity()).toMatchObject({ displayName: "whois67" });
    expect(f.controller.currentIdentity()).toMatchObject({ displayName: "whois67" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${endpoint}/v1/agent/identity`, expect.objectContaining({ method: "GET", cache: "no-store" }));
    expect(f.operations).toEqual(["enterprise-credential-store"]);
    expect(f.broker.snapshot().credential?.displayName).toBe("whois67");
    const restarted = new EnterpriseAuthorizationController({ read: async () => f.configuration } as never,
      { sendFor() {} } as never, f.broker);
    expect(restarted.currentIdentity()).toMatchObject({ displayName: "whois67" });
    expect(lifetime.aborted).toBe(false);
  } finally { f.controller.shutdown(); }
});

it("does not let an older profile response replace a newer refresh", async () => {
  const f = fixture();
  const pending: Array<(response: Response) => void> = [];
  vi.stubGlobal("fetch", () => new Promise<Response>(resolve => { pending.push(resolve); }));
  try {
    const older = f.controller.refreshIdentity();
    const rejected = expect(older).rejects.toThrow("superseded or cancelled");
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const newer = f.controller.refreshIdentity();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!(Response.json({ user: { id: "user", displayName: "Newer name" } }));
    await newer;
    pending[0]!(Response.json({ user: { id: "user", displayName: "Older name" } }));
    await rejected;
    expect(f.controller.currentIdentity()).toMatchObject({ displayName: "Newer name" });
  } finally { f.controller.shutdown(); }
});

it("keeps a refreshed display name across credential rotation without replacing the rotated token", async () => {
  const f = fixture();
  vi.stubGlobal("fetch", async (url: unknown) => String(url).endsWith("/identity")
    ? Response.json({ user: { id: "user", displayName: "whois67" } })
    : Response.json({ accessToken: "synthetic-next", refreshToken: "synthetic-refresh-next",
      activeTeamId: "team", user: { id: "user", displayName: "Old name" },
      expiresAt: new Date(Date.now() + 60_000).toISOString() }));
  try {
    await f.controller.refreshIdentity();
    f.broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available",
      credential: { ...f.broker.snapshot().credential!, refreshToken: "synthetic-refresh", expiresAt: Date.now() } });
    await f.controller.activeCredential(f.configuration as never);
    expect(f.broker.snapshot().credential?.accessToken).toBe("synthetic-next");
    expect(f.controller.currentIdentity()).toMatchObject({ displayName: "whois67" });
    expect(f.operations).toEqual(["enterprise-credential-store", "enterprise-credential-store"]);
    expect(f.broker.snapshot().credential?.displayName).toBe("whois67");
  } finally { f.controller.shutdown(); }
});
it.each(["disconnect", "endpoint", "shutdown"] as const)("rejects a late profile after %s", async action => {
  const f = fixture();
  let release!: (value: Response) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.stubGlobal("fetch", async (url: unknown) => {
    if (!String(url).endsWith("/identity")) return new Response(null, { status: 204 });
    entered();
    return new Promise<Response>(resolve => { release = resolve; });
  });
  const request = f.controller.refreshIdentity();
  const rejected = expect(request).rejects.toThrow("superseded or cancelled");
  try {
    await started;
    if (action === "disconnect") await f.controller.disconnect();
    else if (action === "endpoint") f.configuration.enterpriseGatewayEndpoint = "https://changed.invalid";
    else f.controller.shutdown();
    release(Response.json({ user: { id: "user", displayName: "Late name" } }));
    await rejected;
    expect(f.controller.currentIdentity()).not.toMatchObject({ displayName: "Late name" });
  } finally { f.controller.shutdown(); }
});
it.each(["wrong-user", "invalid-name", "offline"])("keeps credentials intact on %s", async failure => {
  const f = fixture();
  vi.stubGlobal("fetch", async () => {
    if (failure === "offline") throw new Error("Synthetic offline");
    return Response.json({ user: { id: failure === "wrong-user" ? "other" : "user",
      displayName: failure === "invalid-name" ? {} : "wrong" } });
  });
  try {
    await expect(f.controller.refreshIdentity()).rejects.toThrow();
    expect(f.controller.currentIdentity()).toMatchObject({ state: "signed-in", displayName: "Old name" });
    expect(f.operations).toEqual([]);
  } finally { f.controller.shutdown(); }
});
