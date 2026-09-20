import type { UtilityProcess } from "electron";
import { expect, it, vi } from "vitest";
import type { SharedKnowledgeReceiptResult } from "@pi67/protocol";
import { EnterpriseCredentialSupervisor, type SharedKnowledgeReceiptPort } from "./enterprise-credential-supervisor.js";
import { routePrivateHostOperation } from "./agent-host-private-operation.js";

const id = "00000000-0000-4000-8000-000000000001";
const request = { type: "shared-knowledge-receipt-open", requestId: "open", scope: { teamId: id, scopeKind: "team", scopeId: id } };
const credential = { endpoint: "https://fixture.invalid", userId: "user", accountId: id, accessToken: "synthetic-only", expiresAt: 1_900_000_000_000 };
function fixture(receipts?: SharedKnowledgeReceiptPort) {
  return new EnterpriseCredentialSupervisor(() => ({ load: async () => ({ storage: "available", credential }),
    store: async () => {}, clear: async () => {} }), () => receipts);
}
const denied: SharedKnowledgeReceiptResult = { type: "shared-knowledge-receipt-open-result", requestId: "open", ok: false, errorCode: "SCOPE_DENIED" };

it("returns explicit denials when identity or the verified receipt processor is missing", async () => {
  const supervisor = fixture();
  expect(await supervisor.operation(request)).toMatchObject({ errorCode: "NOT_SIGNED_IN" });
  await supervisor.bootstrapMessage();
  expect(await supervisor.operation(request)).toEqual(denied);
  expect(supervisor.operation({ ...request, userId: "forged" })).toBeUndefined();
});

it("routes validated receipt requests to the configured processor and propagates lifecycle invalidation", async () => {
  const receipts = { operation: vi.fn(async () => denied), invalidate: vi.fn() };
  const supervisor = fixture(receipts); await supervisor.bootstrapMessage();
  expect(await supervisor.operation(request)).toEqual(denied);
  expect(receipts.operation).toHaveBeenCalledWith(request);
  await supervisor.operation({ type: "enterprise-credential-clear", requestId: "clear" });
  expect(receipts.invalidate).toHaveBeenCalledTimes(2);
});

it("replaces an obsolete in-flight result with STALE_HANDLE", async () => {
  const gate = Promise.withResolvers<SharedKnowledgeReceiptResult>();
  const supervisor = fixture({ operation: () => gate.promise, invalidate: () => {} });
  await supervisor.bootstrapMessage();
  const pending = supervisor.operation(request); supervisor.invalidateReceiptBindings();
  gate.resolve(denied);
  expect(await pending).toMatchObject({ errorCode: "STALE_HANDLE" });
});

it("redacts processor failures instead of exposing raw errors or leaving a valid request unanswered", async () => {
  const supervisor = fixture({ operation: async () => { throw new Error("synthetic confidential body"); }, invalidate: () => {} });
  await supervisor.bootstrapMessage();
  expect(await supervisor.operation(request)).toEqual({ ...denied, errorCode: "PERSISTENCE_FAILED" });
});

it("uses the current-Host private reply guard and never delivers a result after replacement", async () => {
  const gate = Promise.withResolvers<SharedKnowledgeReceiptResult>();
  const supervisor = fixture({ operation: () => gate.promise, invalidate: () => {} });
  await supervisor.bootstrapMessage();
  const postMessage = vi.fn(), host = { postMessage } as unknown as UtilityProcess;
  let current = true;
  expect(routePrivateHostOperation(host, request, () => current, [supervisor])).toBe(true);
  current = false; gate.resolve(denied);
  await gate.promise; await Promise.resolve(); await Promise.resolve();
  expect(postMessage).not.toHaveBeenCalled();
  expect(routePrivateHostOperation(host, request, () => current, [supervisor])).toBe(false);
});
