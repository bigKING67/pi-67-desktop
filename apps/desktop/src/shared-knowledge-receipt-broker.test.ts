import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { isSharedKnowledgeReceiptResult } from "@pi67/protocol";
import { EnterpriseCredentialSupervisor } from "./enterprise-credential-supervisor.js";
import { SharedKnowledgeReceiptBroker } from "./shared-knowledge-receipt-broker.js";
import { authorizeSharedKnowledge } from "./shared-knowledge-authorization.js";

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const id = "00000000-0000-4000-8000-000000000001", revision = "a".repeat(64);
const scope = { teamId: id, scopeKind: "team" as const, scopeId: id };
const credential = { endpoint: "https://fixture.invalid", userId: "user-one", accountId: id, accessToken: "synthetic-only", expiresAt: 1_900_000_000_000 };
const openMessage = { type: "shared-knowledge-receipt-open", requestId: "open", scope };
const pageJson = JSON.stringify({ ...scope, epoch: id, nextCursor: "1", headCursor: "1", hasMore: false,
  issuedAt: "2026-09-12T00:00:00Z", leaseExpiresAt: "2026-09-12T00:05:00Z", permissionRevision: revision,
  changes: [{ cursor: "1", assetId: id, contentRevision: "b".repeat(64), operation: "revoke" }] });
const append = (handleId: string) => ({ type: "shared-knowledge-receipt-append", requestId: "append", handleId,
  fromCursor: "0", epoch: null, permissionRevision: revision, pageJson });
type PrepareIndex = NonNullable<ConstructorParameters<typeof SharedKnowledgeReceiptBroker>[0]["prepareIndex"]>;
const indexModels = { embedding: { endpoint: "https://embedding.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://extraction.invalid/v1", model: "extract" } };
async function fixture(prepareIndex?: PrepareIndex) {
  const root = await mkdtemp(join(tmpdir(), "new-money-receipt-broker-test-")); roots.push(root);
  const credentials = new EnterpriseCredentialSupervisor(() => ({ load: async () => ({ storage: "available", credential }), store: async () => {}, clear: async () => {} }));
  await credentials.bootstrapMessage();
  const state = { allowed: true, valid: true, signedIn: true };
  const broker = new SharedKnowledgeReceiptBroker({
    ...(prepareIndex ? { prepareIndex } : {}),
    createBinding: (requested) => state.signedIn ? credentials.createReceiptBinding(root, id, requested) : undefined,
    authorize: (requested, identity) => {
      expect(requested).toEqual(scope); expect(identity).toEqual({ endpoint: credential.endpoint, userId: credential.userId });
      return state.allowed ? { permissionRevision: revision, assertValid: () => { if (!state.valid) throw new Error("Synthetic expired grant"); } } : undefined;
    }
  });
  const open = async () => {
    const response = await broker.operation(openMessage);
    if (!response?.ok || response.type !== "shared-knowledge-receipt-open-result") throw new Error("Synthetic open failed");
    return response;
  };
  return { root, credentials, state, broker, open };
}

function indexTask() {
  let reject!: (reason: Error) => void;
  let resolve!: (value: Awaited<Awaited<ReturnType<PrepareIndex>>["completion"]>) => void;
  const completion = new Promise<Awaited<Awaited<ReturnType<PrepareIndex>>["completion"]>>((yes, no) => { resolve = yes; reject = no; });
  void completion.catch(() => undefined);
  const task = { scopeKey: "a".repeat(64), completion, register: vi.fn(), cancel: vi.fn(() => reject(new Error("Synthetic cancelled task"))),
    finish: () => resolve({ scopeKey: "a".repeat(64), directory: "/synthetic-only", documents: [], models: indexModels,
      artifact: { sha256: "b".repeat(64), files: 1, directories: 1, bytes: 15 }, assertArtifactCurrent: async () => undefined, snapshot: {
      scope: { ...scope },
      epoch: id, cursor: "1", capturedHeadCursor: "1", receiptRecord: null, pages: 1, versions: []
    }, publication: { publish: async () => { throw new Error("Unexpected publication from Host wait."); } } }), fail: () => reject(new Error("Synthetic invalid output path must not escape")) };
  return task;
}
const prepareMessage = (handleId: string) => ({ type: "shared-knowledge-index-prepare", requestId: "prepare", handleId, models: structuredClone(indexModels) });

it("prepares only from the Main-owned receipt lease and binds one worker without exposing paths or index readiness", async () => {
  const task = indexTask(), prepare = vi.fn<PrepareIndex>(async input => { input.assertReadable(); return task; });
  const f = await fixture(prepare), { handleId } = await f.open();
  const message = prepareMessage(handleId), pending = f.broker.operation(message);
  message.models.embedding.model = "mutated";
  const ready = await pending;
  if (!ready?.ok || ready.type !== "shared-knowledge-index-prepare-result") throw new Error("Expected prepared ticket");
  expect(isSharedKnowledgeReceiptResult(ready)).toBe(true);
  expect(Object.keys(ready).sort()).toEqual(["indexId", "ok", "requestId", "type"]);
  expect(prepare.mock.calls[0]?.[0]).toMatchObject({ owner: { localProfileId: id, userId: "user-one", endpoint: credential.endpoint, ...scope }, models: indexModels, limits: { maxPages: 100, maxAssets: 100 } });
  const register = { type: "shared-knowledge-index-register", requestId: "register", handleId, indexId: ready.indexId, workerRequestId: id };
  expect(await f.broker.operation(register)).toMatchObject({ ok: true });
  expect(task.register).toHaveBeenCalledExactlyOnceWith(id);
  expect(await f.broker.operation(register)).toMatchObject({ ok: false });
  expect(task.cancel).toHaveBeenCalledOnce();
});

it.each(["close", "identity", "broker", "permission"])("fences prepared index work after %s invalidation", async event => {
  const task = indexTask(), prepare = vi.fn<PrepareIndex>(async () => task);
  const f = await fixture(prepare), { handleId } = await f.open();
  await f.broker.operation(prepareMessage(handleId));
  if (event === "close") await f.broker.operation({ type: "shared-knowledge-receipt-close", requestId: "close", handleId });
  if (event === "identity") f.credentials.invalidateReceiptBindings();
  if (event === "broker") f.broker.invalidate();
  if (event === "permission") f.state.valid = false;
  expect(() => prepare.mock.calls[0]![0].assertReadable()).toThrow();
  if (event === "permission") await f.broker.operation(prepareMessage(handleId));
  expect(task.cancel).toHaveBeenCalledOnce();
});

it("cancels a late prepared task after the owning handle closes and never returns its ticket", async () => {
  const task = indexTask(); let resolve!: (value: Awaited<ReturnType<PrepareIndex>>) => void;
  const prepare = vi.fn<PrepareIndex>(() => new Promise(yes => { resolve = yes; }));
  const f = await fixture(prepare), { handleId } = await f.open();
  const pending = f.broker.operation(prepareMessage(handleId));
  await f.broker.operation({ type: "shared-knowledge-receipt-close", requestId: "close", handleId });
  expect(prepare.mock.calls[0]![0].signal.aborted).toBe(true);
  resolve(task);
  expect(await pending).toMatchObject({ ok: false, errorCode: "STALE_HANDLE" });
  expect(task.cancel).toHaveBeenCalledOnce();
});

it("rejects foreign-handle tickets and duplicate preparation without cancelling the unrelated task", async () => {
  const tasks: ReturnType<typeof indexTask>[] = [];
  const f = await fixture(async () => { const task = indexTask(); tasks.push(task); return task; });
  const first = await f.open(), second = await f.open();
  const ready = await f.broker.operation(prepareMessage(first.handleId));
  if (!ready?.ok || ready.type !== "shared-knowledge-index-prepare-result") throw new Error("Expected ticket");
  expect(await f.broker.operation(prepareMessage(first.handleId))).toMatchObject({ errorCode: "CAPACITY_EXCEEDED" });
  await f.broker.operation(prepareMessage(second.handleId));
  expect(await f.broker.operation({ type: "shared-knowledge-index-register", requestId: "cross", handleId: second.handleId, indexId: ready.indexId, workerRequestId: id })).toMatchObject({ ok: false });
  expect(tasks[0]!.cancel).not.toHaveBeenCalled(); expect(tasks[1]!.cancel).toHaveBeenCalledOnce();
  expect(await f.broker.operation({ type: "shared-knowledge-index-cancel", requestId: "cancel", handleId: first.handleId, indexId: ready.indexId })).toMatchObject({ ok: true });
  expect(tasks[0]!.cancel).toHaveBeenCalledOnce();
});

it("rejects unavailable preparation, stale grants and scheduler failures without success or leaked capacity", async () => {
  const unavailable = await fixture(), handle = await unavailable.open();
  expect(await unavailable.broker.operation(prepareMessage(handle.handleId))).toMatchObject({ ok: false });
  const prepare = vi.fn<PrepareIndex>(async () => { throw new Error("Synthetic scheduler failure"); });
  const f = await fixture(prepare), { handleId } = await f.open();
  for (let attempt = 0; attempt < 5; attempt++) expect(await f.broker.operation(prepareMessage(handleId))).toMatchObject({ errorCode: "PERSISTENCE_FAILED" });
  f.state.valid = false;
  expect(await f.broker.operation(prepareMessage(handleId))).toMatchObject({ errorCode: "SCOPE_DENIED" });
  expect(prepare).toHaveBeenCalledTimes(5);
});

it("holds four cancelled preparation slots until their underlying work settles", async () => {
  const resolvers: Array<(task: Awaited<ReturnType<PrepareIndex>>) => void> = [];
  const f = await fixture(() => new Promise(resolve => { resolvers.push(resolve); }));
  const handles: string[] = [], pending = [];
  for (let count = 0; count < 5; count++) handles.push((await f.open()).handleId);
  for (const handleId of handles.slice(0, 4)) pending.push(Promise.resolve(f.broker.operation(prepareMessage(handleId))));
  expect(await f.broker.operation(prepareMessage(handles[4]!))).toMatchObject({ errorCode: "CAPACITY_EXCEEDED" });
  for (const handleId of handles.slice(0, 4)) await f.broker.operation({ type: "shared-knowledge-receipt-close", requestId: "close", handleId });
  expect(await f.broker.operation(prepareMessage(handles[4]!))).toMatchObject({ errorCode: "CAPACITY_EXCEEDED" });
  for (const resolve of resolvers) resolve(indexTask());
  for (const result of await Promise.all(pending)) expect(result).toMatchObject({ ok: false });
  f.broker.invalidate();
});

it.each(["expired", "registration-failed"])("never reports successful registration for a %s task", async mode => {
  const task = indexTask(), f = await fixture(async () => task), { handleId } = await f.open();
  const ready = await f.broker.operation(prepareMessage(handleId));
  if (!ready?.ok || ready.type !== "shared-knowledge-index-prepare-result") throw new Error("Expected ticket");
  if (mode === "expired") { task.cancel(); await task.completion.catch(() => undefined); }
  else task.register.mockImplementation(() => { throw new Error("Synthetic permit rejected"); });
  expect(await f.broker.operation({ type: "shared-knowledge-index-register", requestId: "register", handleId, indexId: ready.indexId, workerRequestId: id })).toMatchObject({ ok: false });
  expect(task.cancel).toHaveBeenCalledOnce();
  f.broker.invalidate();
});

it.each(["success", "failure", "cancel", "permission"])("waits for the exact Main-verified result and handles %s without publishing", async mode => {
  const task = indexTask(), f = await fixture(async () => task), { handleId } = await f.open();
  const ready = await f.broker.operation(prepareMessage(handleId));
  if (!ready?.ok || ready.type !== "shared-knowledge-index-prepare-result") throw new Error("Expected ticket");
  await f.broker.operation({ type: "shared-knowledge-index-register", requestId: "register", handleId, indexId: ready.indexId, workerRequestId: id });
  let acknowledged = false;
  const pending = f.broker.operation({ type: "shared-knowledge-index-wait", requestId: "wait", handleId, indexId: ready.indexId })!.then(value => { acknowledged = true; return value; });
  await Promise.resolve(); expect(acknowledged).toBe(false);
  if (mode === "failure") task.fail();
  else if (mode === "cancel") await f.broker.operation({ type: "shared-knowledge-index-cancel", requestId: "cancel", handleId, indexId: ready.indexId });
  else { if (mode === "permission") f.state.valid = false; task.finish(); }
  const result = await pending;
  expect(isSharedKnowledgeReceiptResult(result)).toBe(true);
  if (mode === "success") expect(result).toEqual({ type: "shared-knowledge-index-wait-result", requestId: "wait", ok: true, state: "verified-unpublished", snapshot: { epoch: id, cursor: "1" } });
  else expect(result).toMatchObject({ ok: false, errorCode: mode === "permission" ? "SCOPE_DENIED" : "INDEX_FAILED" });
  expect(result).not.toHaveProperty("directory");
  expect(await f.broker.operation({ type: "shared-knowledge-index-wait", requestId: "again", handleId, indexId: ready.indexId })).toMatchObject({ ok: false });
  f.broker.invalidate();
});

it("retains a failed completed result until it is read instead of silently forgetting it", async () => {
  const task = indexTask(), f = await fixture(async () => task), { handleId } = await f.open();
  const ready = await f.broker.operation(prepareMessage(handleId));
  if (!ready?.ok || ready.type !== "shared-knowledge-index-prepare-result") throw new Error("Expected ticket");
  await f.broker.operation({ type: "shared-knowledge-index-register", requestId: "register", handleId, indexId: ready.indexId, workerRequestId: id });
  task.fail(); await task.completion.catch(() => undefined);
  expect(await f.broker.operation({ type: "shared-knowledge-index-wait", requestId: "wait", handleId, indexId: ready.indexId })).toEqual({ type: "shared-knowledge-index-wait-result", requestId: "wait", ok: false, errorCode: "INDEX_FAILED" });
  f.broker.invalidate();
});

it("opens a Main identity handle, persists validated pages, retries exactly and closes without exposing content", async () => {
  const { broker, open } = await fixture();
  const opened = await open();
  expect(opened.progress).toEqual({ epoch: null, cursor: "0" });
  expect(isSharedKnowledgeReceiptResult(opened)).toBe(true);
  const received = await broker.operation(append(opened.handleId));
  expect(received).toMatchObject({ ok: true, progress: { epoch: id, cursor: "1" } });
  expect(isSharedKnowledgeReceiptResult(received)).toBe(true);
  expect(received).not.toHaveProperty("pageJson");
  expect(await broker.operation(append(opened.handleId))).toEqual(received);
  expect(await broker.operation({ type: "shared-knowledge-receipt-close", requestId: "close", handleId: opened.handleId })).toMatchObject({ ok: true });
  expect(await broker.operation(append(opened.handleId))).toMatchObject({ ok: false, errorCode: "STALE_HANDLE" });
  expect((await open()).progress.cursor).toBe("1");
});

it("requires signed-in identity and separate authorization before touching the filesystem", async () => {
  const { root, state, broker } = await fixture();
  state.signedIn = false;
  expect(await broker.operation(openMessage)).toMatchObject({ errorCode: "NOT_SIGNED_IN" });
  state.signedIn = true; state.allowed = false;
  expect(await broker.operation(openMessage)).toMatchObject({ errorCode: "SCOPE_DENIED" });
  expect(await readdir(root)).toEqual([]);
});

it("rejects forged permission revision and retires a denied handle", async () => {
  const { open, broker } = await fixture();
  const { handleId } = await open();
  expect(await broker.operation({ ...append(handleId), permissionRevision: "c".repeat(64) })).toMatchObject({ errorCode: "SCOPE_DENIED" });
  expect(await broker.operation(append(handleId))).toMatchObject({ errorCode: "STALE_HANDLE" });
  expect((await open()).progress.cursor).toBe("0");
});

it("rejects invalid page contents without advancing the receipt cursor", async () => {
  const { open, broker } = await fixture();
  const { handleId } = await open();
  expect(await broker.operation({ ...append(handleId), pageJson: "not JSON" })).toMatchObject({ errorCode: "INVALID_PAGE" });
  const heartbeat = JSON.stringify({ ...JSON.parse(pageJson), changes: [], nextCursor: "9", headCursor: "9" });
  expect(await broker.operation({ ...append(handleId), epoch: id, fromCursor: "9", pageJson: heartbeat }))
    .toMatchObject({ ok: false, errorCode: "INVALID_PAGE" });
  expect((await open()).progress.cursor).toBe("0");
});

it.each(["account", "broker", "permission"])("does not acknowledge an in-flight page after %s invalidation", async (event) => {
  const { open, broker, credentials, state } = await fixture();
  const { handleId } = await open();
  const pending = broker.operation(append(handleId));
  if (event === "account") credentials.invalidateReceiptBindings();
  if (event === "broker") broker.invalidate();
  if (event === "permission") state.valid = false;
  expect(await pending).toMatchObject({ ok: false, errorCode: event === "permission" ? "SCOPE_DENIED" : "STALE_HANDLE" });
  expect(await broker.operation(append(handleId))).toMatchObject({ errorCode: "STALE_HANDLE" });
});

it("bounds pending work and rejects an open invalidated before it returns", async () => {
  const { broker } = await fixture();
  const pending = Array.from({ length: 16 }, () => Promise.resolve(broker.operation(openMessage)));
  expect(await broker.operation(openMessage)).toMatchObject({ errorCode: "CAPACITY_EXCEEDED" });
  broker.invalidate();
  for (const result of await Promise.all(pending)) expect(result).toMatchObject({ ok: false, errorCode: "STALE_HANDLE" });
  expect(await broker.operation(openMessage)).toMatchObject({ ok: true });
  expect(broker.operation({ ...openMessage, userId: "forged" })).toBeUndefined();
});

it("waits for asynchronous authorization before reading the receipt directory", async () => {
  const { root, credentials } = await fixture();
  let allow!: (value: { permissionRevision: string; assertValid(): void }) => void;
  const broker = new SharedKnowledgeReceiptBroker({
    createBinding: (requested) => credentials.createReceiptBinding(root, id, requested),
    authorize: () => new Promise((resolve) => { allow = resolve; })
  });
  const pending = broker.operation(openMessage);
  await vi.waitFor(() => expect(allow).toBeDefined());
  expect(await readdir(root)).toEqual([]);
  allow({ permissionRevision: revision, assertValid() {} });
  expect(await pending).toMatchObject({ ok: true });
});

it("fences concurrent same-scope opens after denial without retiring another scope", async () => {
  const { root, credentials } = await fixture();
  const grant = { permissionRevision: revision, assertValid() {} };
  const authorize = vi.fn<ConstructorParameters<typeof SharedKnowledgeReceiptBroker>[0]["authorize"]>(async () => grant);
  const broker = new SharedKnowledgeReceiptBroker({ createBinding: (requested) => credentials.createReceiptBinding(root, id, requested), authorize });
  const other = await broker.operation({ ...openMessage, scope: { ...scope, scopeKind: "project" } });
  if (!other?.ok || other.type !== "shared-knowledge-receipt-open-result") throw new Error("Expected project handle");
  let allow!: (value: typeof grant) => void;
  authorize.mockImplementationOnce(() => new Promise((resolve) => { allow = resolve; }));
  const pending = broker.operation(openMessage);
  await vi.waitFor(() => expect(allow).toBeDefined());
  authorize.mockResolvedValueOnce(undefined);
  expect(await broker.operation(openMessage)).toMatchObject({ errorCode: "SCOPE_DENIED" });
  allow(grant);
  expect(await pending).toMatchObject({ errorCode: "SCOPE_DENIED" });
  expect(await broker.operation({ type: "shared-knowledge-receipt-close", requestId: "close", handleId: other.handleId })).toMatchObject({ ok: true });
  expect(await broker.operation(openMessage)).toMatchObject({ ok: true });
});

it("does not retire an existing lease on transport failure", async () => {
  const { root, credentials } = await fixture();
  const authorize = vi.fn<ConstructorParameters<typeof SharedKnowledgeReceiptBroker>[0]["authorize"]>(async () => ({ permissionRevision: revision, assertValid() {} }));
  const broker = new SharedKnowledgeReceiptBroker({ createBinding: (requested) => credentials.createReceiptBinding(root, id, requested), authorize });
  const opened = await broker.operation(openMessage);
  if (!opened?.ok || opened.type !== "shared-knowledge-receipt-open-result") throw new Error("Expected handle");
  authorize.mockRejectedValueOnce(new Error("Synthetic transport failure"));
  expect(await broker.operation(openMessage)).toMatchObject({ errorCode: "SCOPE_DENIED" });
  expect(await broker.operation(append(opened.handleId))).toMatchObject({ ok: true });
});

it("composes independent HTTPS authorization with Main receipt persistence and denial", async () => {
  const { root, credentials } = await fixture();
  const now = Date.now();
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ userId: credential.userId, teamId: id,
    role: "member", permissionRevision: revision, issuedAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + 300_000).toISOString() }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  const store = { load: async () => ({ storage: "available" as const, credential }), store: async () => {}, clear: async () => {} };
  const broker = new SharedKnowledgeReceiptBroker({ createBinding: (requested) => credentials.createReceiptBinding(root, id, requested),
    authorize: (requested, identity, signal) => authorizeSharedKnowledge(store, requested, identity, signal) });
  const opened = await broker.operation(openMessage);
  if (!opened?.ok || opened.type !== "shared-knowledge-receipt-open-result") throw new Error("Expected authorized open");
  expect(await broker.operation(append(opened.handleId))).toMatchObject({ ok: true, progress: { cursor: "1" } });
  expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockResolvedValue(new Response(null, { status: 403 }));
  expect(await broker.operation(openMessage)).toMatchObject({ ok: false, errorCode: "SCOPE_DENIED" });
  expect(await broker.operation(append(opened.handleId))).toMatchObject({ errorCode: "STALE_HANDLE" });
});

it("aborts pending authorization on broker invalidation and ignores a late grant", async () => {
  const { root, credentials } = await fixture();
  let signal!: AbortSignal;
  let allow!: (value: { permissionRevision: string; assertValid(): void }) => void;
  const broker = new SharedKnowledgeReceiptBroker({
    createBinding: (requested) => credentials.createReceiptBinding(root, id, requested),
    authorize: (_scope, _identity, supplied) => { signal = supplied; return new Promise((resolve) => { allow = resolve; }); }
  });
  const pending = broker.operation(openMessage);
  await vi.waitFor(() => expect(signal).toBeDefined());
  broker.invalidate();
  expect(signal.aborted).toBe(true);
  expect(await pending).toMatchObject({ errorCode: "STALE_HANDLE" });
  allow({ permissionRevision: revision, assertValid() {} });
  await Promise.resolve();
  expect(await readdir(root)).toEqual([]);
});

it("times out an uncooperative authorization provider and releases pending capacity", async () => {
  const { root, credentials } = await fixture();
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const broker = new SharedKnowledgeReceiptBroker({
    createBinding: (requested) => credentials.createReceiptBinding(root, id, requested),
    authorize: (_scope, _identity, signal) => { signals.push(signal); return new Promise(() => {}); }
  });
  const pending = Array.from({ length: 16 }, () => Promise.resolve(broker.operation(openMessage)));
  await Promise.resolve();
  expect(await broker.operation(openMessage)).toMatchObject({ errorCode: "CAPACITY_EXCEEDED" });
  await vi.advanceTimersByTimeAsync(8_001);
  for (const result of await Promise.all(pending)) expect(result).toMatchObject({ errorCode: "SCOPE_DENIED" });
  expect(signals).toHaveLength(16); expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(await readdir(root)).toEqual([]);
  const next = broker.operation(openMessage); broker.invalidate();
  expect(await next).toMatchObject({ errorCode: "STALE_HANDLE" });
});
