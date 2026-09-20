import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseCredentialSupervisor, type EnterpriseCredentialBrokerPort } from "./enterprise-credential-supervisor.js";
import { SharedKnowledgeReceiptBinding } from "./shared-knowledge-receipt-binding.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const id = "00000000-0000-4000-8000-000000000001";
const credential = { endpoint: "https://fixture.invalid", userId: "user", accountId: id,
  accessToken: "synthetic-test-only", expiresAt: 1_900_000_000_000 };
async function fixture(overrides: Partial<EnterpriseCredentialBrokerPort> = {}) {
  const root = await mkdtemp(join(tmpdir(), "new-money-receipt-lifecycle-test-")); roots.push(root);
  const broker: EnterpriseCredentialBrokerPort = { load: async () => ({ storage: "available", credential }),
    store: async () => {}, clear: async () => {}, ...overrides };
  const supervisor = new EnterpriseCredentialSupervisor(() => broker);
  const binding = () => supervisor.createReceiptBinding(root, id, { teamId: id, scopeKind: "team", scopeId: id });
  return { supervisor, binding, root };
}

it("requires a loaded identity and retires registered bindings synchronously on logout even if persistence fails", async () => {
  const { supervisor, binding } = await fixture({ clear: async () => { throw new Error("Synthetic disk failure"); } });
  expect(binding).toThrow();
  await supervisor.bootstrapMessage();
  const { binding: active } = binding();
  expect(active.signal.aborted).toBe(false);
  const pending = supervisor.operation({ type: "enterprise-credential-clear", requestId: "clear" });
  expect(active.signal.aborted).toBe(true);
  await expect(active.read()).rejects.toThrow("retired");
  await expect(pending).resolves.toMatchObject({ ok: false, errorCode: "PERSISTENCE_FAILED" });
  expect(binding).toThrow();
});

it("fences refresh/store before persistence and only admits new handles after success", async () => {
  const gate = Promise.withResolvers<void>();
  const { supervisor, binding } = await fixture({ store: () => gate.promise });
  await supervisor.bootstrapMessage();
  const { binding: old } = binding();
  const pending = supervisor.operation({ type: "enterprise-credential-store", requestId: "store", credential });
  expect(old.signal.aborted).toBe(true);
  await expect(old.read()).rejects.toThrow("retired");
  expect(binding).toThrow();
  gate.resolve(); await expect(pending).resolves.toMatchObject({ ok: true });
  const { binding: fresh, release } = binding();
  expect(fresh.signal.aborted).toBe(false);
  release(); release();
  expect(fresh.signal.aborted).toBe(true);
  await expect(fresh.read()).rejects.toThrow("retired");
});

it.each(["logout", "host-reset"])("does not reactivate receipt registration from a late store after %s", async (event) => {
  const gate = Promise.withResolvers<void>();
  const { supervisor, binding } = await fixture({ store: () => gate.promise });
  await supervisor.bootstrapMessage();
  const pending = supervisor.operation({ type: "enterprise-credential-store", requestId: "store", credential });
  if (event === "logout") await supervisor.operation({ type: "enterprise-credential-clear", requestId: "clear" });
  else supervisor.invalidateReceiptBindings();
  gate.resolve(); await pending;
  expect(binding).toThrow();
});

it("does not reactivate registration from an obsolete bootstrap completion", async () => {
  const gate = Promise.withResolvers<Awaited<ReturnType<EnterpriseCredentialBrokerPort["load"]>>>();
  const { supervisor, binding } = await fixture({ load: () => gate.promise });
  const pending = supervisor.bootstrapMessage();
  supervisor.invalidateReceiptBindings();
  gate.resolve({ storage: "available", credential }); await pending;
  expect(binding).toThrow();
});

it("ignores malformed requests and bounds retained handles without evicting active ones", async () => {
  const { supervisor, binding } = await fixture();
  await supervisor.bootstrapMessage();
  const { binding: active, release } = binding(), retire = vi.spyOn(active, "retire");
  expect(supervisor.operation({ type: "enterprise-credential-clear" })).toBeUndefined();
  expect(retire).not.toHaveBeenCalled();
  for (let index = 1; index < 128; index += 1) binding();
  expect(binding).toThrow();
  release(); binding();
  supervisor.invalidateReceiptBindings();
  expect(retire).toHaveBeenCalledOnce();
});

it("creates only the current credential user's namespace and ignores caller identity extras", async () => {
  const { supervisor, root } = await fixture();
  await supervisor.bootstrapMessage();
  const scope = { teamId: id, scopeKind: "team" as const, scopeId: id,
    userId: "forged-user", endpoint: "https://forged.invalid", localProfileId: "forged-profile" };
  const { binding: active } = supervisor.createReceiptBinding(root, id, scope);
  const expected = { teamId: id, scopeKind: "team" as const, scopeId: id, epoch: null,
    cursor: "0", limit: 50, permissionRevision: "a".repeat(64) };
  const bytes = new TextEncoder().encode(JSON.stringify({ teamId: id, scopeKind: "team", scopeId: id,
    epoch: id, nextCursor: "1", headCursor: "1", hasMore: false,
    issuedAt: "2026-09-12T00:00:00Z", leaseExpiresAt: "2026-09-12T00:05:00Z",
    permissionRevision: expected.permissionRevision,
    changes: [{ cursor: "1", assetId: id, contentRevision: "b".repeat(64), operation: "revoke" }] }));
  const result = await active.receive(bytes, expected);
  const actualOwner = new SharedKnowledgeReceiptBinding(root, { localProfileId: id,
    endpoint: credential.endpoint, userId: credential.userId, teamId: id, scopeKind: "team", scopeId: id });
  expect(await actualOwner.read()).toEqual(result.receipt);
  await supervisor.operation({ type: "enterprise-credential-store", requestId: "switch",
    credential: { ...credential, userId: "another-user" } });
  expect(active.signal.aborted).toBe(true);
  await expect(active.read()).rejects.toThrow("retired");
  expect(await supervisor.createReceiptBinding(root, id, scope).binding.read()).toBeUndefined();
});

it("snapshots identity before asynchronous credential persistence", async () => {
  const gate = Promise.withResolvers<void>();
  const persisted = vi.fn<EnterpriseCredentialBrokerPort["store"]>(() => gate.promise);
  const { supervisor, root, binding } = await fixture({ store: persisted });
  const mutable = { ...credential };
  const pending = supervisor.operation({ type: "enterprise-credential-store", requestId: "snapshot", credential: mutable });
  mutable.userId = "changed-after-request"; mutable.endpoint = "https://changed.invalid";
  gate.resolve(); await pending;
  expect(persisted.mock.calls[0]?.[0]).toEqual(credential);
  const { binding: current } = binding();
  expect(await current.read()).toBeUndefined();
  // A second factory using the original identity must resolve the same directory.
  const expectedOwner = new SharedKnowledgeReceiptBinding(root, { localProfileId: id,
    endpoint: credential.endpoint, userId: credential.userId, teamId: id, scopeKind: "team", scopeId: id });
  expect(await expectedOwner.read()).toBeUndefined();
  expect(await readdir(root)).toHaveLength(1);
});
