import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SharedKnowledgeReceiptBinding, type SharedKnowledgeReceiptOwner } from "./shared-knowledge-receipt-binding.js";
import { bindSharedKnowledgeOwner } from "./shared-knowledge-owner.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const owner: SharedKnowledgeReceiptOwner = { localProfileId: id, endpoint: "https://fixture.invalid",
  userId: "user-one", teamId: id, scopeKind: "team", scopeId: id };
const expected = { teamId: id, scopeKind: "team" as const, scopeId: id, epoch: null,
  cursor: "0", permissionRevision: "a".repeat(64), limit: 50 };
const bytes = new TextEncoder().encode(JSON.stringify({ ...expected, epoch: other, cursor: undefined, limit: undefined,
  nextCursor: "1", headCursor: "1", hasMore: false, issuedAt: "2026-09-12T00:00:00Z", leaseExpiresAt: "2026-09-12T00:05:00Z",
  changes: [{ cursor: "1", assetId: id, contentRevision: "b".repeat(64), operation: "revoke" }] }));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-receipt-binding-test-")); roots.push(root);
  return root;
}

it("reopens the same owner through equivalent endpoint spellings and writes only hashed directory names", async () => {
  const root = await fixture();
  const first = await new SharedKnowledgeReceiptBinding(root, owner).receive(bytes, expected);
  const reopened = new SharedKnowledgeReceiptBinding(root, { ...owner, endpoint: "https://FIXTURE.invalid:443///" });
  expect(await reopened.read()).toEqual(first.receipt);
  const legacyKey = createHash("sha256").update(JSON.stringify([
    "newmoney.shared-receipt.v1", id, "https://fixture.invalid", "user-one", id, "team", id
  ]), "utf8").digest("hex");
  expect(await readdir(root)).toEqual([legacyKey]);
  expect(bindSharedKnowledgeOwner(owner).key).toBe(legacyKey);
});

it.each([
  { userId: "user-two" }, { localProfileId: other }, { endpoint: "https://other.invalid" },
  { endpoint: "https://fixture.invalid/service" }, { endpoint: "https://fixture.invalid:8443" },
  { teamId: other, scopeId: other }, { scopeKind: "project" as const },
  { scopeKind: "project" as const, scopeId: other }
])("isolates changed owner dimensions: %j", async (change) => {
  const root = await fixture();
  await new SharedKnowledgeReceiptBinding(root, owner).receive(bytes, expected);
  expect(await new SharedKnowledgeReceiptBinding(root, { ...owner, ...change }).read()).toBeUndefined();
});

it("captures owner fields and rejects another scope before any filesystem write", async () => {
  const root = await fixture();
  const mutable = { ...owner };
  const binding = new SharedKnowledgeReceiptBinding(root, mutable);
  mutable.scopeId = other; mutable.userId = "user-two";
  await expect(binding.receive(bytes, { ...expected, scopeId: other })).rejects.toThrow("scope binding mismatch");
  expect(await readdir(root)).toEqual([]);
  const result = await binding.receive(bytes, expected);
  expect(await new SharedKnowledgeReceiptBinding(root, owner).read()).toEqual(result.receipt);
});

it("retires stale handles without deleting history or acknowledging an in-flight receive", async () => {
  const root = await fixture();
  const binding = new SharedKnowledgeReceiptBinding(root, owner);
  const pending = binding.receive(bytes, expected);
  binding.retire();
  await expect(pending).rejects.toThrow("retired");
  await expect(binding.read()).rejects.toThrow("retired");
  await expect(binding.receive(bytes, expected)).rejects.toThrow("retired");
  // The old namespace may finish writing, but a new owner cannot adopt it.
  expect((await new SharedKnowledgeReceiptBinding(root, owner).read())?.cursor).toBe("1");
  expect(await new SharedKnowledgeReceiptBinding(root, { ...owner, userId: "user-two" }).read()).toBeUndefined();
});

it("lets a replacement binding retry while the retired generation is still writing", async () => {
  const root = await fixture();
  const old = new SharedKnowledgeReceiptBinding(root, owner);
  const pending = old.receive(bytes, expected);
  old.retire();
  const replacement = new SharedKnowledgeReceiptBinding(root, owner);
  const retry = replacement.receive(bytes, expected);
  const results = await Promise.allSettled([pending, retry]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
  expect((await replacement.read())?.cursor).toBe("1");
});

it("rejects unsafe endpoints and malformed owners without touching disk", async () => {
  const root = await fixture();
  for (const endpoint of ["http://remote.invalid", "https://name:password@fixture.invalid", "https://fixture.invalid?token=x",
    "https://fixture.invalid#fragment", "https://fixture.invalid?", "file:///tmp", " https://fixture.invalid", "https://fixture.invalid\\path"]) {
    expect(() => new SharedKnowledgeReceiptBinding(root, { ...owner, endpoint })).toThrow();
  }
  for (const change of [{ userId: "" }, { userId: "x\0y" }, { localProfileId: "invalid" }, { scopeId: other }]) {
    expect(() => new SharedKnowledgeReceiptBinding(root, { ...owner, ...change })).toThrow();
  }
  expect(await readdir(root)).toEqual([]);
});
