import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SharedKnowledgeReceiptBinding } from "./shared-knowledge-receipt-binding.js";
import { writeTeamIndexJob } from "./team-index-job.js";

const roots: string[] = [];
const id = "00000000-0000-4000-8000-000000000001", epoch = "00000000-0000-4000-8000-000000000002";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-index-job-")); roots.push(root);
  const owner = { localProfileId: id, endpoint: "https://fixture.invalid", userId: "user", teamId: id, scopeKind: "team" as const, scopeId: id };
  const binding = new SharedKnowledgeReceiptBinding(join(root, "receipts"), owner);
  const directory = join(root, binding.scopeKey, "staging/run-test"); await mkdir(directory, { recursive: true, mode: 0o700 });
  const inode = await lstat(directory), lifetime = new AbortController();
  const assertStorage = async () => {
    const current = await lstat(directory);
    if (current.ino !== inode.ino || current.dev !== inode.dev || current.isSymbolicLink()) throw new Error("changed storage");
  };
  const prepared = { scopeKey: binding.scopeKey, directory, assertStorage,
    async assertCurrent() { lifetime.signal.throwIfAborted(); await assertStorage(); } };
  const input = { binding, prepared, models: { embedding: { endpoint: "https://model.invalid/v1", model: "fixture", dimension: 8 },
    extraction: { endpoint: "https://model.invalid/v1", model: "fixture" } }, limits: { maxPages: 10, maxAssets: 1000 },
    assertReadable: vi.fn(() => undefined), signal: lifetime.signal };
  let cursor = 0;
  const append = async (operation = "upsert", body = "body", assetId = id, head?: string) => {
    const canonicalContent = JSON.stringify(["newmoney.knowledge.v1", "sop", "title", "summary", body]);
    const revision = hash(canonicalContent), next = String(cursor + 1);
    const scope = { teamId: id, scopeKind: "team" as const, scopeId: id };
    await binding.receive(Buffer.from(JSON.stringify({ ...scope, epoch, nextCursor: next, headCursor: head ?? next, hasMore: head !== undefined,
      permissionRevision: "a".repeat(64), issuedAt: "2026-09-13T00:00:00Z", leaseExpiresAt: "2026-09-13T00:01:00Z",
      changes: [{ cursor: next, assetId, operation, contentRevision: revision, ...(operation === "upsert" ? { canonicalContent } : {}) }] })),
    { ...scope, epoch: cursor ? epoch : null, cursor: String(cursor), permissionRevision: "a".repeat(64), limit: 100 });
    cursor += 1; return { assetId, contentRevision: revision };
  };
  const result = async (documents: readonly object[], extra = {}) => writeFile(join(directory, "result.json"),
    JSON.stringify({ schema: "newmoney.team-index-result.v1", scopeKey: binding.scopeKey, documents, ...extra }), { mode: 0o600 });
  return { root, input, binding, prepared, lifetime, append, result };
}

it("writes latest active canonical bodies and verifies exactly those versions after physical completion", async () => {
  const f = await fixture(); await f.append("upsert", "obsolete"); const latest = await f.append("upsert", "latest");
  await f.append("upsert", "revoked", epoch); await f.append("revoke", "revoked", epoch);
  const task = await writeTeamIndexJob(f.input);
  const bytes = await readFile(join(f.prepared.directory, "job.json"), "utf8");
  expect(bytes).toContain("latest"); expect(bytes).not.toContain("obsolete"); expect(bytes).not.toContain("revoked");
  if (process.platform !== "win32") expect((await lstat(join(f.prepared.directory, "job.json"))).mode & 0o777).toBe(0o600);
  expect(task.documents).toEqual([latest]); await f.result([latest]);
  await mkdir(join(f.prepared.directory, "index"), { mode: 0o700 });
  await writeFile(join(f.prepared.directory, "index", "vectors.db"), "synthetic-index", { mode: 0o600 });
  const verified = await task.verifyResult(Promise.resolve("completed"));
  expect(verified.documents).toEqual([latest]); expect(verified).not.toHaveProperty("searchable");
  expect(verified.artifact).toMatchObject({ files: 1, bytes: 15 });
  expect(verified.models).toEqual(f.input.models);
  await verified.assertArtifactCurrent();
  await expect(task.verifyResult(Promise.resolve("completed"))).rejects.toThrow(/already/u);
});

it.each(["missing", "empty", "replaced", "snapshot", "denied", "cancelled"])("rejects %s index bytes or later use despite a valid receipt", async mode => {
  const f = await fixture(); const version = await f.append(), task = await writeTeamIndexJob(f.input);
  await f.result([version]);
  const directory = join(f.prepared.directory, "index"), path = join(directory, "vectors.db");
  if (mode !== "missing") await mkdir(directory, { mode: 0o700 });
  if (mode === "missing" || mode === "empty") {
    await expect(task.verifyResult(Promise.resolve("completed"))).rejects.toThrow(); return;
  }
  await writeFile(path, "synthetic-index", { mode: 0o600 });
  const verified = await task.verifyResult(Promise.resolve("completed"));
  if (mode === "replaced") await writeFile(path, "changed");
  if (mode === "snapshot") await f.append("revoke");
  if (mode === "denied") f.input.assertReadable.mockImplementation(() => { throw new Error("denied"); });
  if (mode === "cancelled") f.lifetime.abort();
  await expect(verified.assertArtifactCurrent()).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe(mode === "replaced" ? "changed" : "synthetic-index");
});

it.each(["owner", "denied", "cancelled", "retired", "incomplete", "empty"])("does not leave a usable input on %s preparation", async (mode) => {
  const f = await fixture();
  if (mode !== "empty") await f.append("upsert", "body", id, mode === "incomplete" ? "9" : undefined);
  if (mode === "owner") f.prepared.scopeKey = "b".repeat(64);
  if (mode === "denied") f.input.assertReadable.mockImplementation(() => { throw new Error("denied"); });
  if (mode === "cancelled") f.lifetime.abort();
  if (mode === "retired") f.binding.retire();
  await expect(writeTeamIndexJob(f.input)).rejects.toThrow();
  expect(await readdir(f.prepared.directory)).toEqual([]);
});

it("cleans its own partial input when read authorization is revoked during replay", async () => {
  const f = await fixture(); await f.append();
  f.input.assertReadable.mockImplementation(() => {
    if (f.input.assertReadable.mock.calls.length === 6) { f.lifetime.abort(); throw new Error("revoked"); }
  });
  await expect(writeTeamIndexJob(f.input)).rejects.toThrow();
  expect(await readdir(f.prepared.directory)).toEqual([]);
});

it.each(["head-changed", "denied", "retired", "cancelled"])("rejects previously successful worker output after %s", async (mode) => {
  const f = await fixture(); const version = await f.append(); const task = await writeTeamIndexJob(f.input); await f.result([version]);
  if (mode === "head-changed") await f.append("revoke");
  if (mode === "denied") f.input.assertReadable.mockImplementation(() => { throw new Error("denied"); });
  if (mode === "retired") f.binding.retire();
  if (mode === "cancelled") f.lifetime.abort();
  await expect(task.verifyResult(Promise.resolve("completed"))).rejects.toThrow();
});

it.each(["failed", "cancelled"] as const)("never reads a success-looking result after worker %s", async (state) => {
  const f = await fixture(); const version = await f.append(); const task = await writeTeamIndexJob(f.input); await f.result([version]);
  await expect(task.verifyResult(Promise.resolve(state))).rejects.toThrow(/did not complete/u);
});

it.each(["scope", "version", "missing", "duplicate", "extra", "oversized"])("rejects %s worker receipts", async (mode) => {
  const f = await fixture(); const version = await f.append(); const task = await writeTeamIndexJob(f.input);
  await f.result(mode === "missing" ? [] : mode === "duplicate" ? [version, version] : [mode === "version" ? { ...version, contentRevision: "b".repeat(64) } : version],
    mode === "scope" ? { scopeKey: "b".repeat(64) } : mode === "extra" ? { searchable: true } : {});
  const path = join(f.prepared.directory, "result.json");
  if (mode === "oversized") await writeFile(path, " ".repeat(32769));
  await expect(task.verifyResult(Promise.resolve("completed"))).rejects.toThrow();
});

it.skipIf(process.platform === "win32").each(["symlink", "fifo"])("rejects %s output without following it or blocking", async (mode) => {
  const f = await fixture(); await f.append(); const task = await writeTeamIndexJob(f.input);
  const path = join(f.prepared.directory, "result.json");
  if (mode === "symlink") await symlink("job.json", path);
  else execFileSync("mkfifo", [path], { timeout: 2000, stdio: "ignore" });
  await expect(task.verifyResult(Promise.resolve("completed"))).rejects.toThrow(/Invalid/u);
});

it.each(["count", "body", "serialized-bytes"])("removes partial input when the %s budget is exceeded", async (mode) => {
  const f = await fixture();
  vi.spyOn(f.binding, "materialize").mockImplementation(async (_limits, stage, signal) => {
    const content = "x".repeat(mode === "body" ? 2 * 1024 * 1024 + 1 : mode === "serialized-bytes" ? 1900000 : 4);
    for (let i = 0; i < (mode === "serialized-bytes" ? 5 : mode === "body" ? 1 : 101); i++) {
      await stage({ assetId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, contentRevision: hash(content), operation: "upsert", cursor: String(i + 1) }, content, signal);
    }
    throw new Error("Fixture unexpectedly exceeded the production budget.");
  });
  await expect(writeTeamIndexJob(f.input)).rejects.toThrow(/Team index .* budget exceeded/u);
  expect(await readdir(f.prepared.directory)).toEqual([]);
});

it("rejects incompatible models before touching staging", async () => {
  const f = await fixture();
  for (const dimension of [2, 5, 4097]) {
    f.input.models.embedding.dimension = dimension;
    await expect(writeTeamIndexJob(f.input)).rejects.toThrow(/dimension/u);
  }
  f.input.models.embedding.dimension = 8;
  for (const endpoint of ["http://localhost/v1", "https://name:password@model.invalid", "https://model.invalid?", "https://model.invalid#"]) {
    f.input.models.embedding.endpoint = endpoint;
    await expect(writeTeamIndexJob(f.input)).rejects.toThrow();
  }
  expect(await readdir(f.prepared.directory)).toEqual([]);
});

it("does not overwrite staging or remove a replaced job file", async () => {
  const f = await fixture(); await f.append(); const task = await writeTeamIndexJob(f.input);
  await expect(writeTeamIndexJob(f.input)).rejects.toThrow(/empty staging/u);
  const path = join(f.prepared.directory, "job.json"); await rename(path, join(f.root, "original-job"));
  await writeFile(path, "retain", { mode: 0o600 });
  await expect(task.discardInput()).rejects.toThrow(/cleanup refused/u);
  expect(await readFile(path, "utf8")).toBe("retain");
});

it("snapshots model fields without serializing extra credential-bearing properties", async () => {
  const f = await fixture(); await f.append();
  Object.assign(f.input.models.embedding, { apiKey: "synthetic-do-not-persist" });
  const pending = writeTeamIndexJob(f.input); f.input.models.embedding.model = "changed";
  const task = await pending;
  const body = await readFile(join(f.prepared.directory, "job.json"), "utf8");
  expect(body).not.toContain("synthetic-do-not-persist"); expect(body).not.toContain("changed");
  await task.discardInput(); await task.discardInput(); expect(await readdir(f.prepared.directory)).toEqual([]);
});
