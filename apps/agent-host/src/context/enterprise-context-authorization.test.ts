import { describe, expect, it, vi } from "vitest";
import { EnterpriseContextController } from "./enterprise-context-controller.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; }
describe("enterprise authorization lifetime", () => {
 it("ignores an old exchange after newer sign-in and acknowledged disconnect", async () => {
  const entered = deferred(), release = deferred(); let starts = 0; const operations: string[] = [];
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  vi.stubGlobal("fetch", async (url: unknown, _options: {body?: string}) => {
   if (String(url).endsWith("/exchange")) {
    if (String(url).includes("/auth-1/")) { entered.resolve(); await release.promise; }
    return Response.json({state:"signed-in", accessToken:"synthetic-fixture", accountId:"account-fixture", userId:"user-fixture", expiresAt});
   }
   return Response.json({authorizationId:`auth-${++starts}`,deviceSecret:"a".repeat(64),verificationUri:"https://fixture.invalid/verify",userCode:"fixture",expiresAt,intervalSeconds:1});
  });
  const broker = new EnterpriseCredentialBrokerClient({postMessage(message) { operations.push(message.type); queueMicrotask(() => broker.handleOperationResult({type:"enterprise-credential-operation-result",requestId:message.requestId,ok:true} as never)); }});
  broker.applyBootstrap({storage:"available"} as never);
  const controller = new EnterpriseContextController({read:async()=>({enterpriseGatewayEndpoint:"https://fixture.invalid"})} as never,{} as never,{sendFor(){}} as never,broker);
  try {
   await controller.beginAuthorization(); const oldPoll = controller.pollAuthorization("auth-1"); await entered.promise;
   await controller.beginAuthorization(); await controller.pollAuthorization("auth-2");
   expect(controller.currentIdentity().state).toBe("signed-in");
   expect((await controller.disconnect()).state).toBe("signed-out");
   expect(broker.snapshot().credential).toBeUndefined();
   release.resolve(); await oldPoll;
   expect(operations).toEqual(["enterprise-credential-store","enterprise-credential-clear"]);
   expect(controller.currentIdentity().state).toBe("signed-out");
  } finally { release.resolve(); controller.shutdown(); vi.unstubAllGlobals(); }
 });
});

it.each(["begin", "disconnect"] as const)("serializes obsolete store cleanup with %s", async (action) => {
  let starts = 0;
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  vi.stubGlobal("fetch", async (url: unknown) => String(url).endsWith("/exchange")
    ? Response.json({ state: "signed-in", accessToken: "synthetic-fixture",
      accountId: "account-fixture", userId: "user-fixture", expiresAt })
    : Response.json({ authorizationId: `auth-${++starts}`, deviceSecret: "a".repeat(64),
      verificationUri: "https://fixture.invalid/verify", userCode: "fixture", expiresAt, intervalSeconds: 1 }));
  const operations: string[] = [];
  let acknowledgeStore!: () => void;
  const broker = new EnterpriseCredentialBrokerClient({ postMessage(message) {
    operations.push(message.type);
    const acknowledge = () => broker.handleOperationResult({
      type: "enterprise-credential-operation-result", requestId: message.requestId, ok: true
    });
    if (message.type === "enterprise-credential-store" && operations.length === 1) {
      acknowledgeStore = acknowledge;
    } else queueMicrotask(acknowledge);
  } });
  broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available" });
  const controller = new EnterpriseContextController(
    { read: async () => ({ enterpriseGatewayEndpoint: "https://fixture.invalid" }) } as never,
    {} as never, { sendFor() {} } as never, broker
  );
  try {
    await controller.beginAuthorization();
    const oldPoll = controller.pollAuthorization("auth-1");
    await vi.waitFor(() => expect(acknowledgeStore).toBeTypeOf("function"));
    const replacement = action === "begin" ? controller.beginAuthorization() : controller.disconnect();
    if (action === "begin") await replacement;
    expect(operations).toEqual(["enterprise-credential-store"]);
    acknowledgeStore();
    await Promise.all([oldPoll, replacement]);
    expect(broker.snapshot().credential).toBeUndefined();
    expect(controller.currentIdentity().state).toBe(action === "begin" ? "pending" : "signed-out");
    if (action === "begin") {
      await controller.pollAuthorization("auth-2");
      expect(controller.currentIdentity().state).toBe("signed-in");
      expect(operations).toEqual([
        "enterprise-credential-store", "enterprise-credential-clear", "enterprise-credential-store"
      ]);
    }
  } finally { controller.shutdown(); vi.unstubAllGlobals(); }
});
