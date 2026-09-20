import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLocalMemoryIdentity } from "./local-memory-identity.mjs";
import { SharedKnowledgeReceiptBinding } from "./shared-knowledge-receipt-binding.js";
import { writeTeamIndexJob } from "./team-index-job.js";
import { openPublishedTeamIndex } from "./team-index-reader.js";
import { SharedKnowledgeReceiptBroker } from "./shared-knowledge-receipt-broker.js";
import { EnterpriseCredentialSupervisor } from "./enterprise-credential-supervisor.js";
import { runNativeTeamIndexQuery } from "./native-team-index-query.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(actual.rm) };
});
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
vi.mock("./native-team-index-query.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./native-team-index-query.js")>();
  return { ...actual, runNativeTeamIndexQuery: vi.fn(actual.runNativeTeamIndexQuery) };
});
const realQuery = await vi.importActual<typeof import("./native-team-index-query.js")>("./native-team-index-query.js");
const id = "00000000-0000-4000-8000-000000000001", epoch = "00000000-0000-4000-8000-000000000002";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.mocked(runNativeTeamIndexQuery).mockReset().mockImplementation(realQuery.runNativeTeamIndexQuery);
  vi.mocked(rm).mockReset().mockImplementation(realFs.rm); for (const dispose of cleanup.splice(0)) await dispose(); vi.useRealTimers(); vi.restoreAllMocks();
});
async function fixture(project = false) {
  const root = await mkdtemp(join(tmpdir(), "new-money-reader-")), localProfileId = await loadLocalMemoryIdentity(root);
  const owner = { localProfileId, userId: "user", endpoint: "https://service.invalid", teamId: id, scopeKind: project ? "project" as const : "team" as const, scopeId: project ? epoch : id };
  const receiptRoot = join(root, "team-projections", "receipts"), binding = new SharedKnowledgeReceiptBinding(receiptRoot, owner);
  const scope = { teamId: owner.teamId, scopeKind: owner.scopeKind, scopeId: owner.scopeId };
  const directory = join(root, "team-projections", binding.scopeKey, "staging/run-test"); await mkdir(directory, { recursive: true, mode: 0o700 });
  let cursor = 0;
  const append = async (operation = "upsert", body = "body") => {
    const canonicalContent = JSON.stringify(["newmoney.knowledge.v1", "sop", "title", "summary", body]);
    const next = String(cursor + 1), contentRevision = hash(canonicalContent);
    await binding.receive(Buffer.from(JSON.stringify({ ...scope, epoch, nextCursor: next, headCursor: next, hasMore: false,
      permissionRevision: "a".repeat(64), issuedAt: "2026-09-13T00:00:00Z", leaseExpiresAt: "2026-09-13T00:01:00Z",
      changes: [{ cursor: next, assetId: id, contentRevision, operation, ...(operation === "upsert" ? { canonicalContent } : {}) }] })),
    { ...scope, epoch: cursor ? epoch : null, cursor: String(cursor), permissionRevision: "a".repeat(64), limit: 100 });
    cursor++; return { assetId: id, contentRevision };
  };
  const document = await append(), lifetime = new AbortController();
  const models = { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } };
  const assertReadable = vi.fn(() => undefined), assertObservation = vi.fn(() => undefined);
  const job = await writeTeamIndexJob({ prepared: { scopeKey: binding.scopeKey, directory, assertCurrent: async () => {}, assertStorage: async () => {} },
    binding, models, signal: lifetime.signal, assertReadable, limits: { maxPages: 10, maxAssets: 100 } });
  await writeFile(join(directory, "result.json"), JSON.stringify({ schema: "newmoney.team-index-result.v1", scopeKey: binding.scopeKey, documents: [document] }), { mode: 0o600 });
  await mkdir(join(directory, "index"), { mode: 0o700 });
  const indexPath = join(directory, "index", "vectors.db"); await writeFile(indexPath, "synthetic vectors", { mode: 0o600 });
  const verified = await job.verifyResult(Promise.resolve("completed"));
  await verified.publication.publish(async () => () => undefined, lifetime.signal);
  // A new binding and reader have no in-memory verification from the producer.
  const restored = new SharedKnowledgeReceiptBinding(receiptRoot, owner), caller = new AbortController();
  const authorize = vi.fn<Parameters<typeof openPublishedTeamIndex>[0]["authorize"]>(async () => assertReadable);
  const revalidate = vi.fn<Parameters<typeof openPublishedTeamIndex>[0]["revalidate"]>(async () => assertObservation);
  const input = { memoryRoot: root, owner, binding: restored, models, signal: caller.signal, authorize, revalidate };
  const leases: Awaited<ReturnType<typeof openPublishedTeamIndex>>[] = [];
  const open = async () => { const lease = await openPublishedTeamIndex(input); leases.push(lease); return lease; };
  const pointer = join(root, "team-projections", binding.scopeKey, "current-index.json");
  const mutateManifest = async (mutate: (record: Record<string, unknown>) => void) => {
    const path = join(directory, "publication.json"), record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    mutate(record); const text = JSON.stringify(record); await writeFile(path, text);
    const next = JSON.parse(await readFile(pointer, "utf8")) as Record<string, unknown>; next.manifest = hash(text); await writeFile(pointer, JSON.stringify(next));
  };
  cleanup.push(async () => { caller.abort(); for (const lease of leases) lease.dispose(); restored.retire(); binding.retire(); await rm(root, { recursive: true, force: true }); });
  return { root, receiptRoot, owner, scope, models, input, restored, binding, caller, directory, indexPath, pointer, document,
    append, open, authorize, revalidate, assertReadable, assertObservation, mutateManifest };
}

it("derives immutable model metadata from the validated publication when Main supplies no model override", async () => {
  const f = await fixture(), { models: _models, ...input } = f.input;
  const reader = await openPublishedTeamIndex(input);
  try {
    expect(reader.models).toEqual(f.models); expect(Object.isFrozen(reader.models.embedding)).toBe(true);
    expect(f.revalidate).toHaveBeenCalledWith({ epoch, cursor: "1" }, expect.any(AbortSignal), f.models);
    await reader.assertCurrent();
  } finally { reader.dispose(); }
});

it.each([false, true])("reads only the exact current canonical receipt body without a worker: project=%s", async project => {
  const f = await fixture(project), reader = await f.open(), before = await readFile(f.indexPath);
  expect(await reader.readDocument(f.document)).toEqual({ ...f.document,
    canonicalContent: JSON.stringify(["newmoney.knowledge.v1", "sop", "title", "summary", "body"]) });
  expect(runNativeTeamIndexQuery).not.toHaveBeenCalled();
  expect(await readFile(f.indexPath)).toEqual(before); await reader.assertCurrent();
});
it.each(["asset", "revision", "revoked", "replaced", "cancelled", "mid-read", "grant", "head"])("withholds body after %s", async mode => {
  const f = await fixture(), reader = await f.open();
  const version = { ...f.document };
  if (mode === "asset") version.assetId = epoch;
  if (mode === "revision") version.contentRevision = "b".repeat(64);
  if (mode === "revoked") await f.append("revoke");
  if (mode === "replaced") await f.append("upsert", "different");
  if (mode === "cancelled") f.caller.abort();
  if (mode === "grant") f.assertReadable.mockImplementation(() => { throw new Error("denied"); });
  if (mode === "head") f.assertObservation.mockImplementation(() => { throw new Error("changed head"); });
  if (mode === "mid-read") {
    const materialize = f.restored.materialize.bind(f.restored);
    vi.spyOn(f.restored, "materialize").mockImplementation(async (...args) => { const result = await materialize(...args); await f.append(); return result; });
  }
  await expect(reader.readDocument(version)).rejects.toThrow(); expect(reader.signal.aborted).toBe(true);
});
it.each(["success", "snapshot", "version", "asset", "denied", "head", "corrupt"].flatMap(mode => [false, true].filter(current => !current || mode !== "snapshot").map(current => ({ mode, current }))))("composes private body read with real receipts: $mode current=$current", async ({ mode, current }) => {
  const f = await fixture();
  const credential = { endpoint: f.owner.endpoint, userId: f.owner.userId, accountId: id, accessToken: "synthetic-only", expiresAt: Date.now() + 600_000 };
  const credentials = new EnterpriseCredentialSupervisor(() => ({ load: async () => ({ storage: "available", credential }), store: async () => {}, clear: async () => {} }));
  await credentials.bootstrapMessage();
  const prepareRuntime = vi.fn(async () => { throw new Error("Read must not prepare or launch a runtime"); });
  const broker = new SharedKnowledgeReceiptBroker({ createBinding: scope => credentials.createReceiptBinding(f.receiptRoot, f.owner.localProfileId, scope),
    authorize: async () => ({ permissionRevision: "d".repeat(64), assertValid: f.assertReadable }),
    revalidateIndex: async () => f.assertObservation, queryConfiguration: () => ({ memoryRoot: f.root, prepareRuntime }) });
  try {
    const opened = await broker.operation({ type: "shared-knowledge-receipt-open", requestId: "open", scope: f.scope });
    if (!opened?.ok || opened.type !== "shared-knowledge-receipt-open-result") throw new Error("fixture open");
    if (mode === "denied") f.assertReadable.mockImplementation(() => { throw new Error("denied"); });
    if (mode === "head") f.assertObservation.mockImplementation(() => { throw new Error("head changed"); });
    if (mode === "corrupt") await writeFile(f.indexPath, "corrupt");
    const result = await broker.operation({ ...(current ? { type: "shared-knowledge-index-read-current" as const } : {
      type: "shared-knowledge-index-read" as const, snapshot: { epoch, cursor: mode === "snapshot" ? "2" : "1" } }), requestId: "read", handleId: opened.handleId, assetId: mode === "asset" ? epoch : id,
      contentRevision: mode === "version" ? "b".repeat(64) : f.document.contentRevision });
    if (mode === "success") expect(result).toEqual({ type: current ? "shared-knowledge-index-read-current-result" : "shared-knowledge-index-read-result", requestId: "read", ok: true,
      snapshot: { epoch, cursor: "1" }, ...f.document, canonicalContent: JSON.stringify(["newmoney.knowledge.v1", "sop", "title", "summary", "body"]) });
    else { expect(result).toMatchObject({ ok: false }); expect(result).not.toHaveProperty("canonicalContent"); }
    expect(prepareRuntime).not.toHaveBeenCalled(); expect(runNativeTeamIndexQuery).not.toHaveBeenCalled();
  } finally { broker.invalidate(); }
});

it.each(["success", "revoke", "foreign", "close", "runtime-denied"])("composes private query messages with real receipt/publication/copy checks: %s", async mode => {
  const f = await fixture();
  const credential = { endpoint: f.owner.endpoint, userId: f.owner.userId, accountId: id, accessToken: "synthetic-only", expiresAt: Date.now() + 600_000 };
  const credentials = new EnterpriseCredentialSupervisor(() => ({ load: async () => ({ storage: "available", credential }), store: async () => {}, clear: async () => {} }));
  await credentials.bootstrapMessage();
  const assertLaunchable = vi.fn(async () => { if (mode === "runtime-denied") throw new Error("Synthetic invalid runtime"); });
  const runtime = { python: "/synthetic/managed/python", bootstrap: "/synthetic/managed/query.py", assertLaunchable };
  const broker = new SharedKnowledgeReceiptBroker({
    createBinding: scope => credentials.createReceiptBinding(f.receiptRoot, f.owner.localProfileId, scope),
    authorize: async () => ({ permissionRevision: "d".repeat(64), assertValid: f.assertReadable }),
    revalidateIndex: async () => f.assertObservation,
    queryConfiguration: () => ({ memoryRoot: f.root, prepareRuntime: async () => runtime })
  });
  vi.mocked(runNativeTeamIndexQuery).mockImplementation(async input => {
    expect(input.python).toBe(runtime.python); expect(input.bootstrap).toBe(runtime.bootstrap);
    expect(input.directory).not.toBe(f.directory); expect(input.directory).toContain("/query-");
    expect(input.request.assetIds).toEqual([f.document.assetId]);
    await input.assertLaunchable(input.signal);
    if (mode === "revoke") await f.append("revoke");
    return [{ assetId: mode === "foreign" ? epoch : f.document.assetId, score: 0.5 }];
  });
  try {
    const opened = await broker.operation({ type: "shared-knowledge-receipt-open", requestId: "open", scope: f.scope });
    if (!opened?.ok || opened.type !== "shared-knowledge-receipt-open-result") throw new Error("Expected fixture handle");
    const prepared = await broker.operation({ type: "shared-knowledge-index-query-prepare", requestId: "prepare", handleId: opened.handleId });
    if (!prepared?.ok || prepared.type !== "shared-knowledge-index-query-prepare-result") throw new Error("Expected fixture query");
    expect(prepared.model).toEqual(f.models.embedding);
    expect(Object.keys(prepared).sort()).toEqual(["type", "requestId", "ok", "queryId", "model", "snapshot"].sort());
    if (mode === "close") await broker.operation({ type: "shared-knowledge-receipt-close", requestId: "close", handleId: opened.handleId });
    const query = { type: "shared-knowledge-index-query", requestId: "query", handleId: opened.handleId, queryId: prepared.queryId, vector: [1, 2, 3, 4], limit: 4 };
    const result = await broker.operation(query);
    if (mode === "success") {
      expect(result).toEqual({ type: "shared-knowledge-index-query-result", requestId: "query", ok: true,
        snapshot: { epoch, cursor: "1" }, hits: [{ ...f.document, score: 0.5 }] });
      expect(await broker.operation({ ...query, requestId: "replay" })).toMatchObject({ ok: false, errorCode: "QUERY_FAILED" });
    } else expect(result).toMatchObject({ ok: false });
    if (mode === "close") expect(runNativeTeamIndexQuery).not.toHaveBeenCalled();
    else expect(assertLaunchable).toHaveBeenCalledOnce();
  } finally { broker.invalidate(); }
});

describe.skipIf(process.platform === "win32")("published index read admission", () => {
it.each([false, true])("restores a published %s scope with real receipts and hashes but no query/model execution", async project => {
  const f = await fixture(project), before = await readFile(f.pointer, "utf8"), lease = await f.open();
  expect(lease.snapshot).toEqual({ epoch, cursor: "1" }); expect(lease.documents).toEqual([f.document]);
  expect(Object.isFrozen(lease.documents)).toBe(true); await lease.assertCurrent([f.document]);
  expect(f.authorize).toHaveBeenCalledOnce(); expect(f.revalidate).toHaveBeenCalledWith({ epoch, cursor: "1" }, expect.any(AbortSignal), f.models);
  expect(await readFile(f.pointer, "utf8")).toBe(before); expect(await readdir(join(f.directory, "index"))).toEqual(["vectors.db"]);
  lease.dispose(); await expect(lease.assertCurrent()).rejects.toThrow("unavailable");
});
it.each(["deny", "head-deny", "profile", "models", "pointer", "manifest", "bytes", "symlink", "receipt-link", "permissions", "owner", "missing"])("rejects %s on restored admission", async mode => {
  const f = await fixture();
  if (mode === "deny") f.authorize.mockRejectedValue(new Error("Synthetic secret denial"));
  if (mode === "head-deny") f.revalidate.mockRejectedValue(new Error("Synthetic head denial"));
  if (mode === "profile") await writeFile(join(f.root, "profile.json"), JSON.stringify({ version: 1, localProfileId: "00000000-0000-4000-8000-000000000099" }));
  if (mode === "models") f.models.embedding.model = "different";
  if (mode === "pointer") await writeFile(f.pointer, "{}");
  if (mode === "manifest") await writeFile(join(f.directory, "publication.json"), "{}");
  if (mode === "bytes") await writeFile(f.indexPath, "tampered vectors");
  if (mode === "symlink") { await rename(f.indexPath, `${f.indexPath}.saved`); await symlink(`${f.indexPath}.saved`, f.indexPath); }
  if (mode === "receipt-link") { await rename(f.receiptRoot, `${f.receiptRoot}.saved`); await symlink(`${f.receiptRoot}.saved`, f.receiptRoot); }
  if (mode === "permissions") await chmod(join(f.directory, "index"), 0o755);
  if (mode === "owner") f.input.owner = { ...f.owner, userId: "other" };
  if (mode === "missing") await rename(f.pointer, `${f.pointer}.saved`);
  await expect(f.open()).rejects.toThrow("unavailable");
});
it.each(["schema", "extra", "documents", "revision", "cursor", "dimension", "artifact"])("rejects rehashed but invalid manifest %s", async mode => {
  const f = await fixture();
  await f.mutateManifest(record => {
    if (mode === "schema") record.schema = "unknown";
    if (mode === "extra") record.path = "/private";
    if (mode === "documents") record.documents = [];
    if (mode === "revision") record.documents = [{ ...f.document, contentRevision: "b".repeat(64) }];
    if (mode === "cursor") record.snapshot = { ...(record.snapshot as object), cursor: "2" };
    if (mode === "dimension") record.models = { ...f.models, embedding: { ...f.models.embedding, dimension: 8 } };
    if (mode === "artifact") record.artifact = { ...(record.artifact as object), bytes: 1 };
  });
  await expect(f.open()).rejects.toThrow("unavailable");
});
it.each(["upsert", "revoke"])("blocks the entire generation on receipt %s, before opening or on later checks", async operation => {
  const f = await fixture(), lease = await f.open(); await f.append(operation, "new body");
  await expect(lease.assertCurrent([f.document])).rejects.toThrow(); expect(lease.signal.aborted).toBe(true);
  await expect(f.open()).rejects.toThrow();
});
it.each(["caller", "binding", "permission", "observation", "bytes", "pointer", "version", "deadline", "clock"])("latches reader invalidation on %s", async mode => {
  const f = await fixture(); vi.useFakeTimers(); const lease = await f.open();
  if (mode === "caller") f.caller.abort();
  if (mode === "binding") f.restored.retire();
  if (mode === "permission") f.assertReadable.mockImplementation(() => { throw new Error("revoked"); });
  if (mode === "observation") f.assertObservation.mockImplementation(() => { throw new Error("retired Host"); });
  if (mode === "bytes") await writeFile(f.indexPath, "tampered vectors");
  if (mode === "pointer") { const bytes = await readFile(f.pointer); await rename(f.pointer, `${f.pointer}.saved`); await writeFile(f.pointer, bytes, { mode: 0o600 }); }
  if (mode === "deadline") vi.advanceTimersByTime(60_001);
  if (mode === "clock") vi.setSystemTime(Date.now() - 1);
  await expect(lease.assertCurrent(mode === "version" ? [{ ...f.document, contentRevision: "e".repeat(64) }] : [])).rejects.toThrow();
  expect(lease.signal.aborted).toBe(true);
  f.assertReadable.mockImplementation(() => undefined); f.assertObservation.mockImplementation(() => undefined);
  await expect(lease.assertCurrent()).rejects.toThrow();
});
it("holds four cancelled pending admissions until IO settles, then permits a new lease", async () => {
  const f = await fixture(), finishes: Array<(check: () => void) => void> = [];
  f.authorize.mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
  const pending = Array.from({ length: 4 }, () => f.open().catch((error: unknown) => error));
  await expect(f.open()).rejects.toThrow(); f.caller.abort();
  f.input.signal = new AbortController().signal;
  await expect(f.open()).rejects.toThrow(); expect(finishes).toHaveLength(4);
  for (const finish of finishes) finish(() => undefined);
  expect((await Promise.all(pending)).every(result => result instanceof Error)).toBe(true);
  f.input.signal = new AbortController().signal; f.authorize.mockResolvedValue(f.assertReadable);
  const lease = await f.open(); await lease.assertCurrent();
});
it("rechecks bytes changed while the final authorization observer was pending", async () => {
  const f = await fixture();
  f.revalidate.mockImplementation(async () => { await writeFile(f.indexPath, "changed while awaiting"); return f.assertObservation; });
  await expect(f.open()).rejects.toThrow();
});
it.each(["success", "read-denied", "observer-denied"])("uses fresh Main authorization and exact Host observation through the real receipt broker: %s", async mode => {
  const f = await fixture();
  const credential = { endpoint: f.owner.endpoint, userId: f.owner.userId, accountId: id, accessToken: "synthetic-only", expiresAt: Date.now() + 600_000 };
  const credentials = new EnterpriseCredentialSupervisor(() => ({ load: async () => ({ storage: "available", credential }), store: async () => {}, clear: async () => {} }));
  await credentials.bootstrapMessage();
  const authorize = vi.fn<ConstructorParameters<typeof SharedKnowledgeReceiptBroker>[0]["authorize"]>(async () => ({ permissionRevision: "d".repeat(64), assertValid: f.assertReadable }));
  const observer = vi.fn(async () => f.assertObservation);
  const broker = new SharedKnowledgeReceiptBroker({ createBinding: scope => credentials.createReceiptBinding(f.receiptRoot, f.owner.localProfileId, scope), authorize, revalidateIndex: observer });
  try {
    const result = await broker.operation({ type: "shared-knowledge-receipt-open", requestId: "open", scope: f.scope });
    if (!result?.ok || result.type !== "shared-knowledge-receipt-open-result") throw new Error("Expected fixture handle");
    if (mode === "read-denied") authorize.mockResolvedValueOnce(undefined);
    if (mode === "observer-denied") observer.mockRejectedValueOnce(new Error("Synthetic stale head"));
    if (mode !== "success") {
      await expect(broker.openIndexReader(result.handleId, { memoryRoot: f.root, models: f.models }, f.caller.signal)).rejects.toThrow();
      if (mode === "read-denied") expect(observer).not.toHaveBeenCalled();
      return;
    }
    const lease = await broker.openIndexReader(result.handleId, { memoryRoot: f.root, models: f.models }, f.caller.signal);
    try {
      await lease.assertCurrent([f.document]); expect(authorize).toHaveBeenCalledTimes(3);
      expect(observer).toHaveBeenCalledWith({ owner: f.owner, models: f.models, snapshot: { epoch, cursor: "1" }, permissionRevision: "d".repeat(64) }, expect.any(AbortSignal));
      credentials.invalidateReceiptBindings(); expect(lease.signal.aborted).toBe(true); await expect(lease.assertCurrent()).rejects.toThrow();
    } finally { lease.dispose(); }
  } finally { broker.invalidate(); }
});
it("counts accepted leases toward capacity and frees one only on disposal", async () => {
  const f = await fixture(), leases = [];
  for (let i = 0; i < 4; i++) leases.push(await f.open());
  await expect(f.open()).rejects.toThrow(); expect(f.authorize).toHaveBeenCalledTimes(4);
  leases[0]!.dispose(); const replacement = await f.open(); await replacement.assertCurrent();
});
it("times out pending observation IO without accepting its late result", async () => {
  const f = await fixture(); vi.useFakeTimers(); let finish!: (check: () => void) => void;
  f.revalidate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const run = f.open(), rejected = expect(run).rejects.toThrow();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  vi.advanceTimersByTime(60_001); finish(() => undefined); await rejected;
});
it("rejects an unknown result identity even if its revision is absent", async () => {
  const f = await fixture(), lease = await f.open();
  const malformed = [{ assetId: "unknown" }] as unknown as Parameters<typeof lease.assertCurrent>[0];
  await expect(lease.assertCurrent(malformed)).rejects.toThrow(); expect(lease.signal.aborted).toBe(true);
});
it.each(["success", "revoke", "failure", "changed-source", "deadline", "cancel-cleanup", "revoke-cleanup", "cleanup-failure"])("revalidates working-copy result and cleans on %s", async mode => {
  const f = await fixture(), lease = await f.open(); let copy = "";
  if (mode === "deadline") vi.useFakeTimers();
  if (mode.endsWith("cleanup")) vi.mocked(rm).mockImplementationOnce(async (path, options) => {
    await realFs.rm(path, options);
    if (mode === "cancel-cleanup") f.caller.abort(); else await f.append("revoke");
  });
  if (mode === "cleanup-failure") vi.mocked(rm).mockRejectedValueOnce(new Error("Synthetic cleanup failure"));
  const run = lease.withWorkingCopy(async directory => {
    copy = directory;
    expect(directory).not.toBe(f.directory);
    await writeFile(join(directory, "index", "vectors.db"), "mutable query metadata");
    if (mode === "revoke") await f.append("revoke");
    if (mode === "failure") throw new Error("query failed");
    if (mode === "changed-source") await writeFile(f.indexPath, "source changed");
    if (mode === "deadline") vi.advanceTimersByTime(60_001);
    return "synthetic result";
  });
  if (mode === "success") { expect(await run).toBe("synthetic result"); await lease.assertCurrent(); }
  else { await expect(run).rejects.toThrow("unavailable"); expect(lease.signal.aborted).toBe(true); }
  if (mode === "cleanup-failure") expect(await readdir(copy)).toEqual(["index"]);
  else await expect(readdir(copy)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(f.indexPath, "utf8")).toBe(mode === "changed-source" ? "source changed" : "synthetic vectors");
});
it("retains cancelled copy and capacity until the operation confirms completion", async () => {
  const f = await fixture(), lease = await f.open(), others = [];
  for (let i = 0; i < 3; i++) others.push(await f.open());
  const entered = Promise.withResolvers<string>(), exited = Promise.withResolvers<void>();
  const run = lease.withWorkingCopy(async (directory, signal) => {
    entered.resolve(directory); await exited.promise; expect(signal.aborted).toBe(true);
  });
  const rejected = expect(run).rejects.toThrow("unavailable"), copy = await entered.promise;
  await expect(lease.withWorkingCopy(async () => {})).rejects.toThrow();
  lease.dispose(); expect(await readdir(copy)).toEqual(["index"]);
  await expect(f.open()).rejects.toThrow();
  exited.resolve(); await rejected;
  await expect(readdir(copy)).rejects.toMatchObject({ code: "ENOENT" });
  const replacement = await f.open(); await replacement.assertCurrent();
});
it.each(["success", "unknown-asset", "revoked-after-query", "retired-during-admission", "wrong-dimension"])("binds vector results to current scope/revision: %s", async mode => {
  const f = await fixture(), lease = await f.open(), assertLaunchable = vi.fn(async () => {
    if (mode === "retired-during-admission") await f.append("revoke");
  });
  let admitted = false;
  vi.mocked(runNativeTeamIndexQuery).mockImplementation(async input => {
    expect(input.request.scopeKey).toBe(f.binding.scopeKey);
    await input.assertLaunchable(input.signal); admitted = true;
    if (mode === "revoked-after-query") await f.append("revoke");
    return [{ assetId: mode === "unknown-asset" ? epoch : id, score: 0.5 }];
  });
  const run = lease.queryVector({ vector: mode === "wrong-dimension" ? Array(8).fill(0.25) : [0.25, 0.75, 0, 0], limit: 4,
    runtime: { python: "/synthetic/python", bootstrap: "/synthetic/query.py", assertLaunchable } });
  if (mode === "success") expect(await run).toEqual([{ ...f.document, score: 0.5 }]);
  else await expect(run).rejects.toThrow("unavailable");
  if (mode === "retired-during-admission" || mode === "wrong-dimension") expect(admitted).toBe(false);
  if (mode === "wrong-dimension") expect(runNativeTeamIndexQuery).not.toHaveBeenCalled();
  expect((await readdir(join(f.root, "team-projections", f.binding.scopeKey, "staging"))).filter(name => name.startsWith("query-"))).toEqual([]);
});
it("retains reader capacity after uncertain physical exit, even when disposed", async () => {
  vi.resetModules();
  const isolated = await import("./team-index-reader.js"), errors = await import("./team-index-artifact.js");
  const f = await fixture(), lease = await isolated.openPublishedTeamIndex(f.input);
  await expect(lease.withWorkingCopy(async () => { throw new errors.TeamIndexWorkingCopyRetentionError(); })).rejects.toThrow("unavailable");
  lease.dispose();
  const others = [];
  try {
    for (let i = 0; i < 3; i++) others.push(await isolated.openPublishedTeamIndex(f.input));
    await expect(isolated.openPublishedTeamIndex(f.input)).rejects.toThrow("unavailable");
  } finally { for (const other of others) other.dispose(); }
});
});
