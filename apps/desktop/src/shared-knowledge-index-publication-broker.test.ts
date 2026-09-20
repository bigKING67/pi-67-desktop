import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseCredentialSupervisor } from "./enterprise-credential-supervisor.js";
import { SharedKnowledgeReceiptBroker } from "./shared-knowledge-receipt-broker.js";

type Dependencies = ConstructorParameters<typeof SharedKnowledgeReceiptBroker>[0];
type Input = Parameters<NonNullable<Dependencies["prepareIndex"]>>[0];
type Task = Awaited<ReturnType<NonNullable<Dependencies["prepareIndex"]>>>;
type Verified = Awaited<Task["completion"]>;
const roots: string[] = [], brokers: SharedKnowledgeReceiptBroker[] = [];
const id = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const scope = { teamId: id, scopeKind: "team" as const, scopeId: id };
const models = { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 8 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } };
afterEach(async () => {
  for (const broker of brokers.splice(0)) broker.invalidate();
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function task(input: Input) {
  let resolve!: (value: Verified) => void;
  const completion = new Promise<Verified>(yes => { resolve = yes; });
  const snapshot = Object.freeze({ epoch: id, cursor: "7", receiptRecord: "b".repeat(64) });
  const artifact = Object.freeze({ sha256: "c".repeat(64), files: 1, directories: 1, bytes: 10 });
  const expected = Object.freeze({ scopeKey: input.binding.scopeKey, snapshot, models: input.models, artifact });
  const pointer = Object.freeze({ schema: "newmoney.team-index-pointer.v1" as const, scopeKey: input.binding.scopeKey,
    generation: "run-synthetic", manifest: "d".repeat(64), epoch: id, cursor: "7" });
  // Real broker/credential binding, synthetic scheduler and filesystem commit.
  // Actual atomic filesystem and native output have separate regression suites.
  const publish = vi.fn<Verified["publication"]["publish"]>(async (check, signal) => {
    const assertValid = await check(expected, signal); assertValid();
    return { state: "published-local", pointer };
  });
  const value: Verified = { scopeKey: input.binding.scopeKey, directory: "/synthetic-only", models: input.models,
    snapshot: { ...snapshot, scope: { ...scope }, capturedHeadCursor: "7", pages: 1, versions: [] }, documents: [], artifact,
    assertArtifactCurrent: async () => input.assertReadable(), publication: { publish } };
  return { scopeKey: input.binding.scopeKey, completion, register: vi.fn(), cancel: vi.fn(),
    finish: () => resolve(value), publish, expected, input, pointer };
}
async function fixture(observer = true) {
  const root = await mkdtemp(join(tmpdir(), "new-money-publication-broker-")); roots.push(root);
  const credential = { endpoint: "https://service.invalid", userId: "user", accountId: id, accessToken: "synthetic-only", expiresAt: Date.now() + 600_000 };
  const credentials = new EnterpriseCredentialSupervisor(() => ({ load: async () => ({ storage: "available", credential }), store: async () => {}, clear: async () => {} }));
  await credentials.bootstrapMessage();
  const assertGrant = vi.fn(() => undefined), assertHead = vi.fn(() => undefined);
  const authorize = vi.fn<Dependencies["authorize"]>(async () => ({ permissionRevision: "a".repeat(64), assertValid: assertGrant }));
  const revalidate = vi.fn<NonNullable<Dependencies["revalidateIndex"]>>(async () => assertHead);
  const tasks: ReturnType<typeof task>[] = [];
  const broker = new SharedKnowledgeReceiptBroker({ createBinding: requested => credentials.createReceiptBinding(root, id, requested), authorize,
    ...(observer ? { revalidateIndex: revalidate } : {}), prepareIndex: async input => { const created = task(input); tasks.push(created); return created; } });
  brokers.push(broker);
  const open = async () => {
    const result = await broker.operation({ type: "shared-knowledge-receipt-open", requestId: "open", scope });
    if (!result?.ok || result.type !== "shared-knowledge-receipt-open-result") throw new Error("Expected open");
    return result.handleId;
  };
  const prepare = async (handleId: string) => {
    const result = await broker.operation({ type: "shared-knowledge-index-prepare", requestId: "prepare", handleId, models });
    if (!result?.ok || result.type !== "shared-knowledge-index-prepare-result") throw new Error("Expected preparation");
    const selected = tasks.at(-1)!;
    await broker.operation({ type: "shared-knowledge-index-register", requestId: "register", handleId, indexId: result.indexId, workerRequestId: id });
    const message = { handleId, indexId: result.indexId, requestId: "publish", type: "shared-knowledge-index-publish" as const };
    return { ...selected, message,
      wait: () => broker.operation({ ...message, type: "shared-knowledge-index-wait", requestId: "wait" }),
      publishRequest: () => broker.operation(message),
      close: () => broker.operation({ type: "shared-knowledge-receipt-close", requestId: "close", handleId }) };
  };
  const ready = async () => { const run = await prepare(await open()); run.finish(); await run.wait(); return run; };
  return { credentials, authorize, revalidate, assertGrant, assertHead, broker, open, prepare, ready };
}

it("retains the exact verified result for a single publish and freshly composes Main read plus head/model checks", async () => {
  const f = await fixture(), run = await f.ready();
  expect(run.publish).not.toHaveBeenCalled(); expect(f.revalidate).not.toHaveBeenCalled();
  f.authorize.mockResolvedValueOnce({ permissionRevision: "e".repeat(64), assertValid: () => undefined });
  const result = await run.publishRequest();
  expect(result).toEqual({ type: "shared-knowledge-index-publish-result", requestId: "publish", ok: true,
    state: "published-local", snapshot: { epoch: id, cursor: "7" } });
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(f.revalidate).toHaveBeenCalledExactlyOnceWith({ owner: run.input.owner, models, snapshot: { epoch: id, cursor: "7" }, permissionRevision: "e".repeat(64) }, expect.any(AbortSignal));
  expect(JSON.stringify(result)).not.toContain("synthetic-only"); expect(result).not.toHaveProperty("pointer");
  await expect(run.publishRequest()).resolves.toMatchObject({ ok: false });
  expect(run.publish).toHaveBeenCalledOnce(); expect(run.input.signal.aborted).toBe(true);
});

it("fails closed without an installed production head/model observer", async () => {
  const f = await fixture(false), run = await f.ready();
  expect(await run.publishRequest()).toMatchObject({ ok: false, errorCode: "INDEX_FAILED" });
  expect(run.publish).not.toHaveBeenCalled(); expect(f.authorize).toHaveBeenCalledTimes(1);
});

it.each(["before-completion", "before-wait", "foreign-handle", "wrong-index"])("rejects %s publication without filesystem work", async mode => {
  const f = await fixture(), run = await f.prepare(await f.open());
  if (mode !== "before-completion") run.finish();
  if (mode === "foreign-handle" || mode === "wrong-index") await run.wait();
  const message = { ...run.message, ...(mode === "foreign-handle" ? { handleId: await f.open() } : mode === "wrong-index" ? { indexId: other } : {}) };
  expect(await f.broker.operation(message)).toMatchObject({ ok: false }); expect(run.publish).not.toHaveBeenCalled();
  run.finish();
});

it.each(["close", "identity", "invalidate", "cancel", "expired-grant"])("retires a wait-consumed result on %s", async mode => {
  const f = await fixture(), run = await f.ready();
  if (mode === "close") await run.close();
  if (mode === "identity") f.credentials.invalidateReceiptBindings();
  if (mode === "invalidate") f.broker.invalidate();
  if (mode === "cancel") await f.broker.operation({ ...run.message, type: "shared-knowledge-index-cancel" });
  if (mode === "expired-grant") f.assertGrant.mockImplementation(() => { throw new Error("expired"); });
  expect(await run.publishRequest()).toMatchObject({ ok: false }); expect(run.publish).not.toHaveBeenCalled();
  expect(run.input.signal.aborted).toBe(true);
});

it.each(["unread", "waited"])("expires %s results 90 seconds after completion without extending the deadline", async mode => {
  vi.useFakeTimers(); const f = await fixture(), run = await f.prepare(await f.open()); run.finish(); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(80_000);
  if (mode === "waited") expect(await run.wait()).toMatchObject({ ok: true });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(run.input.signal.aborted).toBe(true);
  expect(await run.publishRequest()).toMatchObject({ ok: false }); expect(run.publish).not.toHaveBeenCalled();
});

it.each([91_000, -1])("checks the retention wall clock even before the timer fires: %s", async delta => {
  vi.useFakeTimers(); const f = await fixture(), run = await f.ready();
  vi.setSystemTime(Date.now() + delta);
  expect(await run.publishRequest()).toMatchObject({ ok: false }); expect(run.publish).not.toHaveBeenCalled();
  expect(run.input.signal.aborted).toBe(true);
});

it("holds four retained results until close releases a slot", async () => {
  const f = await fixture(), runs = [];
  for (let i = 0; i < 4; i++) runs.push(await f.ready());
  const handleId = await f.open();
  expect(await f.broker.operation({ type: "shared-knowledge-index-prepare", requestId: "overflow", handleId, models })).toMatchObject({ errorCode: "CAPACITY_EXCEEDED" });
  await runs[0]!.close(); const next = await f.prepare(handleId); next.finish();
});

it("propagates explicit fresh Main denial to other handles in the exact scope", async () => {
  const f = await fixture(), run = await f.ready(), sibling = await f.open();
  f.authorize.mockResolvedValueOnce(undefined);
  expect(await run.publishRequest()).toMatchObject({ ok: false }); expect(f.revalidate).not.toHaveBeenCalled();
  expect(await f.broker.operation({ type: "shared-knowledge-index-prepare", requestId: "again", handleId: sibling, models })).toMatchObject({ errorCode: "STALE_HANDLE" });
});

it.each(["head-denied", "invalid-revision", "cancel-during-authorization", "cancel-during-head"])("cannot commit after %s", async mode => {
  const f = await fixture(), run = await f.ready();
  if (mode === "head-denied") f.revalidate.mockRejectedValueOnce(new Error("synthetic provider detail"));
  if (mode === "invalid-revision") f.authorize.mockResolvedValueOnce({ permissionRevision: "invalid", assertValid: () => undefined });
  if (mode === "cancel-during-authorization") f.authorize.mockImplementationOnce(async () => { await run.close(); return { permissionRevision: "a".repeat(64), assertValid: () => undefined }; });
  if (mode === "cancel-during-head") f.revalidate.mockImplementationOnce(async () => { await run.close(); return f.assertHead; });
  expect(await run.publishRequest()).toMatchObject({ ok: false }); expect(run.input.signal.aborted).toBe(true);
});

it.each(["duplicate", "close", "deadline"])("holds publishing IO on %s and never acknowledges its late success", async mode => {
  vi.useFakeTimers(); const f = await fixture(), run = await f.ready();
  let finish!: (value: Awaited<ReturnType<Verified["publication"]["publish"]>>) => void;
  run.publish.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = run.publishRequest();
  if (mode === "duplicate") expect(await run.publishRequest()).toMatchObject({ ok: false });
  if (mode === "close") await run.close();
  if (mode === "deadline") await vi.advanceTimersByTimeAsync(90_000);
  const others = [];
  for (let i = 0; i < 3; i++) others.push(await f.ready());
  const handleId = await f.open();
  expect(await f.broker.operation({ type: "shared-knowledge-index-prepare", requestId: "full", handleId, models })).toMatchObject({ errorCode: "CAPACITY_EXCEEDED" });
  finish({ state: "published-local", pointer: run.pointer });
  expect(await pending).toMatchObject({ ok: false, errorCode: "PUBLICATION_INDETERMINATE" });
  const next = await f.prepare(handleId); next.finish();
});

it("preserves indeterminate publication over concurrent identity loss", async () => {
  const f = await fixture(), run = await f.ready();
  run.publish.mockImplementationOnce(async () => {
    f.credentials.invalidateReceiptBindings(); throw Object.assign(new Error("private IO detail"), { outcome: "indeterminate" });
  });
  expect(await run.publishRequest()).toEqual({ type: "shared-knowledge-index-publish-result", requestId: "publish", ok: false, errorCode: "PUBLICATION_INDETERMINATE" });
});
