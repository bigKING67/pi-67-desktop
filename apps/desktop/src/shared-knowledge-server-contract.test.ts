import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { decodeKnowledgeSyncPage } from "@pi67/protocol";
import { afterEach, expect, it } from "vitest";
import { SharedKnowledgeReceiptBinding } from "./shared-knowledge-receipt-binding.js";
import { writeTeamIndexJob } from "./team-index-job.js";

// Explicit offline wire replay of a guarded VPS test export, not live grants,
// native index execution, model calls or a sibling-source/build dependency.
const source = process.env.PI67_NEWMONEY_CONTRACT_INPUT;
const roots: string[] = [];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function text(value: unknown): string { assert.equal(typeof value, "string"); return value as string; }
async function fixture() {
  assert.ok(source && isAbsolute(source), "Set an absolute PI67_NEWMONEY_CONTRACT_INPUT; no automatic server lookup");
  const info = await lstat(source);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 5 * 1024 * 1024, "Invalid contract file");
  const contract = record(JSON.parse(await readFile(source, "utf8")) as unknown);
  assert.equal(contract.schema, "newmoney.synthetic-publication-contract.v1");
  const publication = record(contract.publication);
  const upsertBytes = Buffer.from(text(contract.upsertPageJson));
  const revokeBytes = Buffer.from(text(contract.revokedPageJson));
  const firstWire = record(JSON.parse(upsertBytes.toString()) as unknown);
  const lastWire = record(JSON.parse(revokeBytes.toString()) as unknown);
  assert.equal(firstWire.scopeKind, "project");
  const scope = { teamId: text(firstWire.teamId), scopeKind: "project" as const, scopeId: text(firstWire.scopeId) };
  const start = { ...scope, cursor: "0", epoch: null, permissionRevision: text(firstWire.permissionRevision), limit: 100 };
  const upsert = decodeKnowledgeSyncPage(upsertBytes, start, hash);
  const continuation = { ...scope, cursor: upsert.nextCursor, epoch: upsert.epoch,
    permissionRevision: text(lastWire.permissionRevision), limit: 100 };
  const revoke = decodeKnowledgeSyncPage(revokeBytes, continuation, hash);
  assert.equal(upsert.hasMore, false); assert.equal(revoke.hasMore, false);
  assert.equal(upsert.changes.length, 1); assert.equal(revoke.changes.length, 1);
  const document = upsert.changes[0]; assert.ok(document);
  assert.equal(document.operation, "upsert"); assert.ok(document.canonicalContent);
  assert.equal(document.assetId, publication.assetId); assert.equal(document.contentRevision, publication.contentRevision);
  assert.equal(publication.replayed, false);
  assert.ok(Number.isFinite(Date.parse(text(publication.publishedAt))));
  assert.deepEqual(JSON.parse(document.canonicalContent) as unknown,
    ["newmoney.knowledge.v1", "experience", "Publication fixture", "Synthetic summary", "Synthetic body"]);
  assert.deepEqual(revoke.changes, [{ cursor: revoke.nextCursor, assetId: document.assetId,
    contentRevision: document.contentRevision, operation: "revoke" }]);
  const root = await mkdtemp(join(tmpdir(), "new-money-server-contract-")); roots.push(root);
  const owner = { ...scope, localProfileId: randomUUID(), endpoint: "https://contract.invalid", userId: "synthetic-contract-user" };
  const receiptRoot = join(root, "receipts");
  const binding = new SharedKnowledgeReceiptBinding(receiptRoot, owner);
  return { root, owner, receiptRoot, binding, start, continuation, upsertBytes, revokeBytes, upsert, revoke, document };
}

it.skipIf(!source)("replays server publication bytes into durable Desktop receipts and exact index input, then fences revocation", async () => {
  const f = await fixture();
  const received = await f.binding.receive(f.upsertBytes, f.start);
  assert.ok(received.receipt);
  expect(received.receipt.cursor).toBe(f.upsert.nextCursor);
  const binding = new SharedKnowledgeReceiptBinding(f.receiptRoot, f.owner);
  expect(await binding.read()).toEqual(received.receipt);
  expect((await binding.receive(f.upsertBytes, f.start)).receipt).toEqual(received.receipt);
  const directory = join(f.root, "staging"); await mkdir(directory, { mode: 0o700 });
  const original = await lstat(directory);
  const assertStorage = async () => {
    const current = await lstat(directory);
    assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.ino === original.ino && current.dev === original.dev);
  };
  // Deliberately synthetic current read permission. Historical wire leases are
  // never refreshed, replaced or interpreted as authorization in this test.
  let readable = false;
  const input = { binding, prepared: { scopeKey: binding.scopeKey, directory, assertStorage, assertCurrent: assertStorage },
    models: { embedding: { endpoint: "https://model.invalid/v1", model: "fixture", dimension: 8 },
      extraction: { endpoint: "https://model.invalid/v1", model: "fixture" } },
    limits: { maxPages: 10, maxAssets: 100 }, signal: new AbortController().signal,
    assertReadable() { if (!readable) throw new Error("Synthetic current read permission denied"); } };
  await expect(writeTeamIndexJob(input)).rejects.toThrow("current read permission denied");
  expect(await readdir(directory)).toEqual([]);
  readable = true;
  const job = await writeTeamIndexJob(input);
  expect(job.documents).toEqual([{ assetId: f.document.assetId, contentRevision: f.document.contentRevision }]);
  const written = record(JSON.parse(await readFile(join(directory, "job.json"), "utf8")) as unknown);
  expect(written.documents).toEqual([{ assetId: f.document.assetId, contentRevision: f.document.contentRevision,
    canonicalContent: f.document.canonicalContent }]);
  await job.assertSnapshotCurrent();
  await binding.receive(f.revokeBytes, f.continuation);
  await expect(job.assertSnapshotCurrent()).rejects.toThrow("snapshot changed");
  await job.discardInput();
  await expect(writeTeamIndexJob(input)).rejects.toThrow("empty");
  expect(await readdir(directory)).toEqual([]);
  expect((await new SharedKnowledgeReceiptBinding(f.receiptRoot, f.owner).read())?.cursor).toBe(f.revoke.nextCursor);
  expect(await new SharedKnowledgeReceiptBinding(f.receiptRoot, { ...f.owner, userId: "another-user" }).read()).toBeUndefined();
});

it.skipIf(!source).each(["scope", "content"])("rejects %s drift in the actual exported server page before persistence", async mode => {
  const f = await fixture();
  const bytes = mode === "content" ? Buffer.from(f.upsertBytes.toString().replace("Synthetic body", "Tampered body")) : f.upsertBytes;
  const expected = mode === "scope" ? { ...f.start, scopeId: randomUUID() } : f.start;
  await expect(f.binding.receive(bytes, expected)).rejects.toThrow();
  expect(await f.binding.read()).toBeUndefined();
});
