import { EventEmitter } from "node:events";
import type { UtilityProcess } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import type { createInstalledLocalMemory } from "./installed-local-memory.js";
import type { NativeTeamModelWorkerExit, NativeTeamModelWorkerOptions } from "./native-team-model-worker.mjs";
import { SharedKnowledgeReceiptBinding } from "./shared-knowledge-receipt-binding.js";
vi.mock("electron", async () => ({ MessageChannelMain: (await import("node:worker_threads")).MessageChannel }));
import { TeamWorkerSupervisor } from "./team-worker-supervisor.js";

const id = "00000000-0000-4000-8000-000000000001";
type Preparation = ReturnType<typeof createInstalledLocalMemory>["teamPreparation"];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());
function fixture() {
  const owner = { localProfileId: id, endpoint: "https://fixture.invalid", userId: "user", teamId: id, scopeKind: "team" as const, scopeId: id };
  const binding = new SharedKnowledgeReceiptBinding("/unused-receipts", owner), lifetime = new AbortController();
  const host = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  let current: UtilityProcess | undefined = host as unknown as UtilityProcess;
  const exit = deferred<NativeTeamModelWorkerExit>();
  const launch = vi.fn(async (_options: NativeTeamModelWorkerOptions, _signal: AbortSignal) => ({ pid: 42, completion: exit.promise, stop: async () => undefined }));
  const workers = new TeamWorkerSupervisor(() => current, launch);
  const prepared = { owner, scopeKey: binding.scopeKey, directory: "/fixture/staging/run-test", bootstrap: "/fixture/runtime/worker.py",
    runtime: { python: "/fixture/runtime/python", runtimeRoot: "/fixture/runtime", tree: { sha256: "a".repeat(64), fileCount: 1, totalBytes: 1 } },
    assertCurrent: vi.fn(async () => undefined), assertStorage: vi.fn(async () => undefined),
    assertLaunchable: vi.fn(async () => undefined), discard: vi.fn(async () => undefined) };
  const result = { snapshot: { receiptRecord: "fixture-record" }, documents: [] };
  const job = { ...result, discardInput: vi.fn(async () => undefined), assertSnapshotCurrent: vi.fn(async () => undefined),
    verifyResult: vi.fn(async (completion: Promise<"completed" | "cancelled">) => {
      if (await completion !== "completed") throw new Error("not completed"); return result;
    }) };
  const prepareIndexWorker = vi.fn(async () => prepared), writeIndexJob = vi.fn(async () => job);
  // Deliberately synthetic storage/model results: these tests prove scheduling,
  // not runtime admission, receipt materialization or Python indexing.
  const preparation = { prepare: prepareIndexWorker, prepareIndexWorker, writeIndexJob } as unknown as Preparation;
  const input = { owner, binding, signal: lifetime.signal, assertReadable: vi.fn(() => undefined), limits: { maxPages: 10, maxAssets: 100 },
    models: { embedding: { endpoint: "https://model.invalid/v1", model: "fixture", dimension: 8 }, extraction: { endpoint: "https://model.invalid/v1", model: "fixture" } } };
  const prepare = () => workers.indexJobs.prepare(preparation, input);
  const start = () => workers.handleMessage(host as unknown as UtilityProcess, { type: "team-worker-start", requestId: id });
  return { owner, binding, lifetime, host, workers, prepared, job, prepareIndexWorker, writeIndexJob, input,
    preparation, prepare, start, exit, launch, replace: () => { current = undefined; } };
}

it("registers the fixed Main launch only once and waits for exact physical completion", async () => {
  const f = fixture(), task = await f.prepare();
  expect(f.launch).not.toHaveBeenCalled(); task.register(id); f.start();
  await vi.waitFor(() => expect(f.launch).toHaveBeenCalledOnce());
  expect(f.prepared.assertLaunchable).toHaveBeenCalledOnce(); expect(f.job.assertSnapshotCurrent).toHaveBeenCalledOnce();
  expect(f.launch.mock.calls[0]![0]).toMatchObject({ python: f.prepared.runtime.python, bootstrap: f.prepared.bootstrap, cwd: f.prepared.directory, arguments: [] });
  let finished = false; void task.completion.then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false);
  f.exit.resolve({ code: 0, signal: null });
  await expect(task.completion).resolves.toMatchObject({ directory: f.prepared.directory, scopeKey: f.binding.scopeKey });
  expect(f.job.discardInput).not.toHaveBeenCalled(); expect(f.prepared.discard).not.toHaveBeenCalled();
  expect(f.host.listenerCount("exit")).toBe(0); await f.workers.shutdown();
});

it.each(["owner", "binding", "host-exit", "invalidate", "replacement", "deadline", "shutdown"])("rejects late preparation and cleans before any permit on %s", async mode => {
  vi.useFakeTimers(); const f = fixture(), held = deferred<typeof f.prepared>();
  f.prepareIndexWorker.mockReturnValueOnce(held.promise);
  const ready = f.prepare(); await Promise.resolve();
  const rejected = expect(ready).rejects.toThrow();
  let shutdown: Promise<void> | undefined;
  if (mode === "owner") f.lifetime.abort();
  if (mode === "binding") f.binding.retire();
  if (mode === "host-exit") f.host.emit("exit", 1);
  if (mode === "invalidate") f.workers.invalidate();
  if (mode === "replacement") f.replace();
  if (mode === "deadline") vi.advanceTimersByTime(60_000);
  if (mode === "shutdown") shutdown = f.workers.shutdown();
  held.resolve(f.prepared); await rejected; await shutdown;
  expect(f.writeIndexJob).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled();
  expect(f.prepared.discard).toHaveBeenCalledOnce(); expect(f.host.listenerCount("exit")).toBe(0);
  await f.workers.shutdown(); expect(vi.getTimerCount()).toBe(0);
});

it.each(["cancel", "deadline", "invalid-reservation"])("cleans an unused ready task on %s", async mode => {
  vi.useFakeTimers(); const f = fixture(), task = await f.prepare();
  if (mode === "cancel") task.cancel();
  if (mode === "deadline") vi.advanceTimersByTime(5_000);
  if (mode === "invalid-reservation") expect(() => task.register("invalid")).toThrow();
  await expect(task.completion).rejects.toThrow();
  expect(f.job.discardInput).toHaveBeenCalledOnce(); expect(f.prepared.discard).toHaveBeenCalledOnce();
  expect(() => task.register(id)).toThrow(); expect(f.launch).not.toHaveBeenCalled();
  await f.workers.shutdown(); expect(vi.getTimerCount()).toBe(0);
});

it("rejects duplicate scope and bounds preparing plus ready slots without coalescing selections", async () => {
  const f = fixture(), first = await f.prepare();
  await expect(f.prepare()).rejects.toThrow("unavailable");
  const tasks = [first];
  for (let index = 1; index < 4; index += 1) {
    const owner = { ...f.owner, userId: `user-${index}` }, binding = new SharedKnowledgeReceiptBinding("/unused", owner);
    tasks.push(await f.workers.indexJobs.prepare(f.preparation, { ...f.input, owner, binding }));
  }
  const owner = { ...f.owner, userId: "overflow" };
  await expect(f.workers.indexJobs.prepare(f.preparation, { ...f.input, owner, binding: new SharedKnowledgeReceiptBinding("/unused", owner) })).rejects.toThrow("unavailable");
  f.workers.invalidate(); await Promise.allSettled(tasks.map(task => task.completion));
  const replacement = await f.prepare(); replacement.cancel(); await expect(replacement.completion).rejects.toThrow(); await f.workers.shutdown();
});

it("captures owner/model/budgets before preparation and drops extra credential properties", async () => {
  const f = fixture(); Object.assign(f.input.models.embedding, { apiKey: "synthetic-not-for-job" });
  const ready = f.prepare();
  f.input.owner.userId = "changed"; f.input.models.embedding.model = "changed"; f.input.limits.maxPages = 999;
  const task = await ready;
  expect(f.prepareIndexWorker.mock.calls[0]).toEqual([expect.objectContaining({ userId: "user" }), expect.any(AbortSignal)]);
  expect(f.writeIndexJob.mock.calls[0]).toEqual([expect.objectContaining({ models: expect.objectContaining({ embedding: expect.objectContaining({ model: "fixture" }) }), limits: { maxPages: 10, maxAssets: 100 } })]);
  expect(JSON.stringify(f.writeIndexJob.mock.calls)).not.toContain("synthetic-not-for-job");
  task.cancel(); await expect(task.completion).rejects.toThrow(); await f.workers.shutdown();
});

it.each(["host", "scope", "aborted", "retired", "stopped"])("refuses initial %s without storage work", async mode => {
  const f = fixture();
  if (mode === "host") f.replace();
  if (mode === "scope") f.input.owner.userId = "another-user";
  if (mode === "aborted") f.lifetime.abort();
  if (mode === "retired") f.binding.retire();
  if (mode === "stopped") await f.workers.shutdown();
  await expect(f.prepare()).rejects.toThrow("unavailable");
  expect(f.prepareIndexWorker).not.toHaveBeenCalled(); await f.workers.shutdown();
});

it.each(["prepare", "writer", "read-grant", "verify"])("does not acknowledge %s failure as a completed index", async mode => {
  const f = fixture();
  if (mode === "prepare") f.prepareIndexWorker.mockRejectedValueOnce(new Error("prepare failed"));
  if (mode === "writer") f.writeIndexJob.mockRejectedValueOnce(new Error("writer failed"));
  if (mode === "read-grant") f.input.assertReadable.mockImplementationOnce(() => { throw new Error("read denied"); });
  if (mode !== "verify") {
    await expect(f.prepare()).rejects.toThrow(); expect(f.launch).not.toHaveBeenCalled();
    expect(f.prepared.discard).toHaveBeenCalledTimes(mode === "writer" ? 1 : 0);
  } else {
    const task = await f.prepare();
    f.job.verifyResult.mockImplementationOnce(async completion => { await completion; throw new Error("stale result"); });
    task.register(id); f.start(); await vi.waitFor(() => expect(f.launch).toHaveBeenCalledOnce());
    f.exit.resolve({ code: 0, signal: null }); await expect(task.completion).rejects.toThrow("stale result");
    expect(f.job.discardInput).not.toHaveBeenCalled();
  }
  await f.workers.shutdown();
});

it.each(["runtime", "snapshot", "cancel-preflight"])("refuses spawn on %s without poisoning physical containment", async mode => {
  const f = fixture(), task = await f.prepare();
  if (mode === "runtime") f.prepared.assertLaunchable.mockRejectedValueOnce(new Error("runtime changed"));
  if (mode === "snapshot") f.job.assertSnapshotCurrent.mockRejectedValueOnce(new Error("snapshot changed"));
  if (mode === "cancel-preflight") f.prepared.assertLaunchable.mockImplementationOnce(async () => { f.binding.retire(); });
  task.register(id); f.start(); await expect(task.completion).rejects.toThrow();
  expect(f.launch).not.toHaveBeenCalled(); expect(f.job.discardInput).not.toHaveBeenCalled();
  // A verified no-launch refusal must not permanently disable other scopes.
  const permit = f.workers.register(id, { python: "/fixture/python", bootstrap: "/fixture/worker", cwd: "/fixture/run", arguments: [] }, new AbortController().signal);
  permit.cancel(); await permit.completion; await f.workers.shutdown();
});

it.each(["binding", "duplicate", "invalidate"])("holds the scope slot until physical exit after active %s", async mode => {
  const f = fixture(), task = await f.prepare(); task.register(id); f.start();
  await vi.waitFor(() => expect(f.launch).toHaveBeenCalledOnce());
  if (mode === "binding") f.binding.retire();
  if (mode === "duplicate") expect(() => task.register(id)).toThrow("already");
  if (mode === "invalidate") f.workers.invalidate();
  expect(f.launch.mock.calls[0]![1].aborted).toBe(true);
  await expect(f.prepare()).rejects.toThrow("unavailable");
  let done = false; const shutdown = f.workers.shutdown().then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false);
  f.exit.resolve({ code: null, signal: "SIGTERM" }); await expect(task.completion).rejects.toThrow(); await shutdown;
  expect(f.job.discardInput).not.toHaveBeenCalled(); expect(f.prepared.discard).not.toHaveBeenCalled();
});

it("retains ambiguous staging and makes cleanup failure sticky and observable", async () => {
  const f = fixture(), task = await f.prepare(); f.job.discardInput.mockRejectedValueOnce(new Error("replaced file"));
  task.cancel(); await expect(task.completion).rejects.toThrow("cleanup could not be confirmed");
  expect(f.prepared.discard).not.toHaveBeenCalled(); await expect(f.prepare()).rejects.toThrow("unavailable");
  await expect(f.workers.shutdown()).rejects.toThrow("could not be confirmed");
});
