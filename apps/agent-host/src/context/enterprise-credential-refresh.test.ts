import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseAuthorizationController } from "./enterprise-authorization-controller.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";

const endpoint = "https://fixture.invalid";
const configuration = { enterpriseGatewayEndpoint: endpoint };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

function fixture(holdStore = false) {
  const entered = deferred(), release = deferred(), stored = deferred();
  const operations: string[] = [];
  let acknowledgeStore = () => {};
  let refreshCount = 0;
  vi.stubGlobal("fetch", async (url: unknown) => {
    if (String(url).endsWith("/refresh")) {
      refreshCount += 1;
      entered.resolve();
      await release.promise;
      return Response.json({ accessToken: "synthetic-next", refreshToken: "synthetic-refresh-next",
        activeTeamId: "team", user: { id: "user", email: "fixture@example.test" },
        expiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
    if (String(url).endsWith("/device-authorizations")) return Response.json({
      authorizationId: "new-auth", deviceCode: "a".repeat(64), verificationUri: `${endpoint}/verify`,
      userCode: "fixture", expiresAt: new Date(Date.now() + 60_000).toISOString(), intervalSeconds: 1
    });
    return new Response(null, { status: 204 });
  });
  const broker = new EnterpriseCredentialBrokerClient({ postMessage(message) {
    operations.push(message.type);
    const acknowledge = () => broker.handleOperationResult({
      type: "enterprise-credential-operation-result", requestId: message.requestId, ok: true
    });
    if (holdStore && message.type === "enterprise-credential-store") {
      acknowledgeStore = acknowledge;
      stored.resolve();
    } else queueMicrotask(acknowledge);
  } });
  broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available",
    credential: { endpoint, accountId: "team", userId: "user", accessToken: "synthetic-old",
      refreshToken: "synthetic-refresh-old", expiresAt: Date.now() + 1_000 } });
  const controller = new EnterpriseAuthorizationController(
    { read: async () => configuration } as never, { sendFor() {} } as never, broker
  );
  return { controller, broker, operations, entered, release, stored,
    acknowledgeStore: () => acknowledgeStore(), refreshCount: () => refreshCount };
}

it.each(["disconnect", "begin", "shutdown"] as const)("rejects late refresh after %s", async (action) => {
  const f = fixture();
  const refresh = f.controller.activeCredential(configuration as never);
  const rejected = expect(refresh).rejects.toThrow("superseded or cancelled");
  try {
    await f.entered.promise;
    if (action === "disconnect") await f.controller.disconnect();
    else if (action === "begin") await f.controller.beginAuthorization();
    else f.controller.shutdown();
    await expect(f.controller.activeCredential(configuration as never)).rejects.toThrow();
    f.release.resolve();
    await rejected;
    expect(f.operations).not.toContain("enterprise-credential-store");
    if (action === "disconnect") {
      expect(f.broker.snapshot().credential).toBeUndefined();
      expect(f.controller.currentIdentity().state).toBe("signed-out");
    }
  } finally { f.release.resolve(); f.controller.shutdown(); }
});

it.each(["disconnect", "begin"] as const)("clears a refresh superseded during secure store by %s", async (action) => {
  const f = fixture(true);
  const refresh = f.controller.activeCredential(configuration as never);
  const rejected = expect(refresh).rejects.toThrow("superseded or cancelled");
  try {
    f.release.resolve();
    await f.stored.promise;
    const transition = action === "disconnect" ? f.controller.disconnect() : f.controller.beginAuthorization();
    f.acknowledgeStore();
    await Promise.all([rejected, transition]);
    expect(f.broker.snapshot().credential).toBeUndefined();
    expect(f.operations.slice(0, 2)).toEqual(["enterprise-credential-store", "enterprise-credential-clear"]);
  } finally { f.release.resolve(); f.controller.shutdown(); }
});

it("shares one current refresh and retains its acknowledged credential", async () => {
  const f = fixture();
  try {
    const first = f.controller.activeCredential(configuration as never);
    const second = f.controller.activeCredential(configuration as never);
    await f.entered.promise;
    f.release.resolve();
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(f.refreshCount()).toBe(1);
    expect(f.operations).toEqual(["enterprise-credential-store"]);
    expect(f.controller.currentIdentity().state).toBe("signed-in");
  } finally { f.release.resolve(); f.controller.shutdown(); }
});

it("does not let a late remote disconnect clear a newer login", async () => {
  const f = fixture();
  const entered = deferred(), release = deferred();
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/sessions/current")) {
      entered.resolve();
      await release.promise;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/exchange")) return Response.json({
      accessToken: "synthetic-new-login", refreshToken: "synthetic-new-login-refresh",
      activeTeamId: "new-team", user: { id: "new-user", email: "new@example.test" },
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    return originalFetch(input, init);
  });
  try {
    const disconnect = f.controller.disconnect();
    await entered.promise;
    await f.controller.beginAuthorization();
    await f.controller.pollAuthorization("new-auth");
    release.resolve();
    await disconnect;
    expect(f.broker.snapshot().credential?.userId).toBe("new-user");
    expect(f.operations).toEqual(["enterprise-credential-store"]);
    expect(f.controller.currentIdentity().state).toBe("signed-in");
  } finally { release.resolve(); f.controller.shutdown(); }
});
