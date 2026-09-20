import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseAuthorizationController } from "./enterprise-authorization-controller.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import { cleanupRouterFixtures, createRouter } from "./context-memory-command-router.test-support.js";

const id = "00000000-0000-4000-8000-000000000001";
afterEach(async () => { vi.restoreAllMocks(); await cleanupRouterFixtures(); });
function fixture() {
  const broker = new EnterpriseCredentialBrokerClient({ postMessage(message) {
    queueMicrotask(() => {
      if (message.type === "shared-knowledge-receipt-open") broker.handleReceiptResult({ type: `${message.type}-result`, requestId: message.requestId,
        ok: true, handleId: id, userId: id, endpoint: "https://example.com", progress: { epoch: null, cursor: "0" } });
      if (message.type === "shared-knowledge-receipt-append") broker.handleReceiptResult({ type: `${message.type}-result`, requestId: message.requestId,
        ok: true, progress: { epoch: null, cursor: "0" } });
      if (message.type === "shared-knowledge-receipt-close") broker.handleReceiptResult({ type: `${message.type}-result`, requestId: message.requestId, ok: true });
    });
  } });
  broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential: {
    endpoint: "https://example.com", userId: id, accountId: id, accessToken: "synthetic", expiresAt: Date.now() + 600_000
  } });
  const controller = new EnterpriseAuthorizationController({ read: async () => ({ enterpriseGatewayEndpoint: "https://example.com" }) } as never, { sendFor() {} } as never, broker);
  const authorize = vi.spyOn(EnterpriseContextGatewayClient.prototype, "authorizeTeam").mockResolvedValue({
    permissionRevision: "a".repeat(64), deadline: Date.now() + 300_000, assertValid() {}, assertModel() {}, assertAgentModel() {}
  });
  const sync = vi.spyOn(EnterpriseContextGatewayClient.prototype, "syncKnowledge").mockResolvedValue({ bytes: new TextEncoder().encode("{}"), page: {
    teamId: id, scopeKind: "team", scopeId: id, epoch: null, nextCursor: "0", headCursor: "0", hasMore: false,
    permissionRevision: "a".repeat(64), issuedAt: Date.now(), leaseExpiresAt: Date.now() + 300_000, changes: []
  } });
  return { controller, broker, authorize, sync };
}
it("routes the application command to the enterprise owner", async () => {
  const result = { progress: { epoch: null, cursor: "0" }, pages: 1, headCursor: "0" };
  const spy = vi.spyOn(EnterpriseAuthorizationController.prototype, "syncKnowledge").mockResolvedValue(result);
  const { router } = await createRouter();
  const signal = new AbortController().signal;
  expect(await router.dispatchApp({ type: "enterprise.knowledge.sync", payload: { teamId: id } }, undefined, signal)).toEqual(result);
  expect(spy).toHaveBeenCalledWith({ teamId: id }, signal);
});
it("runs bounded receipt synchronization using the current login and returns only progress", async () => {
  const f = fixture();
  expect(await f.controller.syncKnowledge({ teamId: id })).toEqual({ progress: { epoch: null, cursor: "0" }, pages: 1, headCursor: "0" });
  expect(f.authorize).toHaveBeenCalledOnce(); expect(f.sync).toHaveBeenCalledOnce();
  f.controller.shutdown();
});
it("limits concurrent runs and shutdown cancels stalled transport", async () => {
  const f = fixture();
  f.sync.mockImplementation((_expected, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  }));
  const pending = Array.from({ length: 4 }, () => f.controller.syncKnowledge({ teamId: id }));
  const settled = Promise.allSettled(pending);
  await vi.waitFor(() => expect(f.sync).toHaveBeenCalledTimes(4));
  await expect(f.controller.syncKnowledge({ teamId: id })).rejects.toThrow("busy");
  f.controller.shutdown();
  expect((await settled).every((result) => result.status === "rejected")).toBe(true);
  await expect(f.controller.syncKnowledge({ teamId: id })).rejects.toThrow("superseded");
});

it("propagates caller cancellation to active transport and allows a subsequent run", async () => {
  const f = fixture(), caller = new AbortController();
  f.sync.mockImplementationOnce((_expected, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(new Error("caller cancelled")), { once: true });
  }));
  const pending = f.controller.syncKnowledge({ teamId: id }, caller.signal);
  const assertion = expect(pending).rejects.toThrow("caller cancelled");
  await vi.waitFor(() => expect(f.sync).toHaveBeenCalledOnce());
  caller.abort(); await assertion;
  expect(f.broker.sharedKnowledgeReceipts()?.signal.aborted).toBe(false);
  await expect(f.controller.syncKnowledge({ teamId: id })).resolves.toHaveProperty("pages", 1);
  f.controller.shutdown();
});
