import { expect, it } from "vitest";
import type { EnterpriseCredentialOperationResult } from "@pi67/protocol";
import { EnterpriseCredentialBrokerClient, type EnterpriseCredentialParentPort } from "./enterprise-credential-broker-client.js";

const id = "00000000-0000-4000-8000-000000000001";
const credential = { endpoint: "https://fixture.invalid", userId: "user", accountId: id,
  accessToken: "synthetic-only", expiresAt: 1_900_000_000_000 };
function fixture() {
  const messages: Parameters<EnterpriseCredentialParentPort["postMessage"]>[0][] = [];
  const broker = new EnterpriseCredentialBrokerClient({ postMessage: (message) => { messages.push(message); } });
  const bootstrap = (userId = credential.userId) => broker.applyBootstrap({ type: "enterprise-credential-bootstrap",
    storage: "available", credential: { ...credential, userId } });
  const acknowledge = (requestId: string, ok = true) => broker.handleOperationResult({ type: "enterprise-credential-operation-result",
    requestId, ok, ...(ok ? {} : { errorCode: "PERSISTENCE_FAILED" }) } as EnterpriseCredentialOperationResult);
  return { broker, bootstrap, messages, acknowledge };
}
const open = { type: "shared-knowledge-receipt-open" as const, scope: { teamId: id, scopeKind: "team" as const, scopeId: id } };

it("creates the identity client without sending requests and routes exact receipt replies", async () => {
  const { broker, bootstrap, messages } = fixture();
  expect(broker.sharedKnowledgeReceipts()).toBeUndefined();
  bootstrap(); expect(messages).toHaveLength(0);
  const pending = broker.sharedKnowledgeReceipts()!.request(open);
  expect(broker.handleReceiptResult({ type: "shared-knowledge-receipt-open-result", requestId: messages[0]!.requestId,
    ok: true, userId: credential.userId, endpoint: credential.endpoint, handleId: id, progress: { epoch: null, cursor: "0" } })).toBe(true);
  expect(await pending).toMatchObject({ ok: true });
});

it("retires old clients before a failed clear and never silently reactivates them", async () => {
  const { broker, bootstrap, messages, acknowledge } = fixture(); bootstrap();
  const old = broker.sharedKnowledgeReceipts()!;
  const pending = old.request(open), rejected = expect(pending).rejects.toThrow("shutting down");
  const clearing = broker.clear();
  expect(broker.sharedKnowledgeReceipts()).toBeUndefined();
  acknowledge(messages.at(-1)!.requestId, false);
  await expect(clearing).rejects.toMatchObject({ code: "RUNTIME_NOT_READY" }); await rejected;
  await expect(old.request(open)).rejects.toThrow("stopped");
  expect(broker.sharedKnowledgeReceipts()).toBeUndefined();
});

it("does not restore a late store after logout", async () => {
  const { broker, bootstrap, messages, acknowledge } = fixture(); bootstrap();
  const storing = broker.store({ ...credential, userId: "old-store" }), storeId = messages.at(-1)!.requestId;
  const clearing = broker.clear(); acknowledge(messages.at(-1)!.requestId); await clearing;
  acknowledge(storeId);
  await expect(storing).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
  expect(broker.snapshot()).toEqual({ storage: "available" });
  expect(broker.sharedKnowledgeReceipts()).toBeUndefined();
});

it("preserves newer bootstrap identity over an older store acknowledgement", async () => {
  const { broker, bootstrap, messages, acknowledge } = fixture(); bootstrap();
  const storing = broker.store(credential), storeId = messages.at(-1)!.requestId;
  bootstrap("new-user"); const latest = broker.sharedKnowledgeReceipts();
  acknowledge(storeId);
  await expect(storing).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
  expect(broker.snapshot().credential?.userId).toBe("new-user");
  expect(broker.sharedKnowledgeReceipts()).toBe(latest);
});

it("snapshots stored identity and prevents bootstrap or new writes after shutdown", async () => {
  const { broker, bootstrap, messages, acknowledge } = fixture(); bootstrap();
  const mutable = { ...credential }, storing = broker.store(mutable);
  mutable.userId = "mutated"; acknowledge(messages.at(-1)!.requestId); await storing;
  expect(broker.snapshot().credential?.userId).toBe(credential.userId);
  const client = broker.sharedKnowledgeReceipts()!;
  broker.shutdown(); bootstrap("late-user");
  expect(broker.sharedKnowledgeReceipts()).toBeUndefined();
  await expect(client.request(open)).rejects.toThrow("stopped");
  await expect(broker.store(credential)).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
});
