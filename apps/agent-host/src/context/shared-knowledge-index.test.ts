import { afterEach, expect, it, vi } from "vitest";
import type { SharedKnowledgeReceiptResult } from "@pi67/protocol";
import { runSharedKnowledgeIndex } from "./shared-knowledge-index.js";

const id = "00000000-0000-4000-8000-000000000001";
const scope = { teamId: id, scopeKind: "team" as const, scopeId: id };
const models = { embedding: { endpoint: "https://models.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://models.invalid/v1", model: "extract" } };
type Options = Parameters<typeof runSharedKnowledgeIndex>[0];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());
function fixture() {
  const calls: string[] = [], caller = new AbortController(), identity = new AbortController(), channel = new AbortController();
  const native = deferred<"completed" | "cancelled">(), verified = deferred<SharedKnowledgeReceiptResult>();
  const reservation: ReturnType<Options["reserve"]> = { phase: "worker", requestId: id, signal: channel.signal, connected: Promise.resolve(), activate: vi.fn(), stop: vi.fn(() => { channel.abort(); }) };
  const worker = { completion: native.promise, stop: vi.fn(() => { native.resolve("cancelled"); return native.promise; }) };
  const request = vi.fn<Options["receipts"]["request"]>(async message => {
    calls.push(message.type);
    if (message.type === "shared-knowledge-receipt-open") return { type: "shared-knowledge-receipt-open-result", requestId: "open", ok: true, handleId: id, userId: "fixture", endpoint: "https://service.invalid", progress: { epoch: id, cursor: "1" } };
    if (message.type === "shared-knowledge-index-prepare") return { type: "shared-knowledge-index-prepare-result", requestId: "prepare", ok: true, indexId: id };
    if (message.type === "shared-knowledge-index-register") return { type: "shared-knowledge-index-register-result", requestId: "register", ok: true };
    if (message.type === "shared-knowledge-index-wait") return verified.promise;
    if (message.type === "shared-knowledge-index-publish") return { type: "shared-knowledge-index-publish-result", requestId: "publish", ok: true, state: "published-local", snapshot: { epoch: id, cursor: "7" } };
    if (message.type === "shared-knowledge-index-cancel") {
      native.resolve("cancelled"); verified.resolve({ type: "shared-knowledge-index-wait-result", requestId: "wait", ok: false, errorCode: "INDEX_FAILED" });
      return { type: "shared-knowledge-index-cancel-result", requestId: "cancel", ok: true };
    }
    if (message.type === "shared-knowledge-receipt-close") return { type: "shared-knowledge-receipt-close-result", requestId: "close", ok: true };
    throw new Error("Unexpected test request");
  });
  const reserve = vi.fn((signal: AbortSignal) => {
    calls.push("reserve"); signal.addEventListener("abort", () => { channel.abort(); native.resolve("cancelled"); verified.resolve({ type: "shared-knowledge-index-wait-result", requestId: "wait", ok: false, errorCode: "INDEX_FAILED" }); }, { once: true });
    return reservation;
  });
  const start = vi.fn<Options["workers"]["start"]>(async () => { calls.push("start"); return worker; });
  const revalidate = vi.fn<Options["revalidate"]>(async () => () => undefined);
  const options: Options = { receipts: { request, signal: identity.signal }, workers: { start }, scope: { ...scope }, models: structuredClone(models), reserve, assertCurrent: vi.fn(), revalidate, signal: caller.signal };
  return { calls, caller, identity, reservation, worker, native, verified, request, reserve, start, options,
    revalidate, run: () => runSharedKnowledgeIndex(options), finish: () => { native.resolve("completed"); verified.resolve({ type: "shared-knowledge-index-wait-result", requestId: "wait", ok: true, state: "verified-unpublished", snapshot: { epoch: id, cursor: "7" } }); } };
}

it("orders preparation before reservation, registration before spawn, and requires both completion witnesses", async () => {
  const f = fixture(), run = f.run();
  f.options.scope.scopeId = "mutated"; f.options.models.embedding.model = "mutated";
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  expect(f.calls).toEqual(["shared-knowledge-receipt-open", "shared-knowledge-index-prepare", "reserve", "shared-knowledge-index-register", "shared-knowledge-index-wait", "start"]);
  expect(f.request.mock.calls[0]?.[0]).toMatchObject({ scope });
  expect(f.request.mock.calls[1]?.[0]).toMatchObject({ models });
  let settled = false; void run.then(() => { settled = true; });
  f.native.resolve("completed"); await Promise.resolve(); expect(settled).toBe(false);
  expect(f.revalidate).not.toHaveBeenCalled();
  f.finish(); expect(await run).toEqual({ state: "published-local", snapshot: { epoch: id, cursor: "7" } });
  expect(f.revalidate).toHaveBeenCalledWith({ epoch: id, cursor: "7" }, expect.any(AbortSignal));
  expect(f.request.mock.calls.find(([message]) => message.type === "shared-knowledge-index-publish")?.[0]).toEqual({ type: "shared-knowledge-index-publish", handleId: id, indexId: id });
  expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close"); expect(f.reservation.stop).toHaveBeenCalledOnce();
});

it.each(["caller", "identity"] as const)("cancels a running job on %s retirement and drains before closing", async event => {
  const f = fixture(), run = f.run(), rejected = expect(run).rejects.toThrow();
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  f[event].abort(); await rejected;
  expect(f.calls).toContain("shared-knowledge-index-cancel"); expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
  expect(f.worker.stop).toHaveBeenCalledOnce();
});

it("fails fast on Main verification failure instead of waiting for the whole worker budget", async () => {
  const f = fixture(), run = f.run(), rejected = expect(run).rejects.toThrow();
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  f.verified.resolve({ type: "shared-knowledge-index-wait-result", requestId: "wait", ok: false, errorCode: "INDEX_FAILED" });
  await rejected; expect(f.worker.stop).toHaveBeenCalledOnce();
});

it("cancels on an early Main failure and drains a late startup before closing the handle", async () => {
  const f = fixture(), startup = deferred<Awaited<ReturnType<Options["workers"]["start"]>>>();
  f.start.mockImplementation(() => startup.promise);
  const run = f.run(), rejected = expect(run).rejects.toThrow();
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  f.verified.resolve({ type: "shared-knowledge-index-wait-result", requestId: "wait", ok: false, errorCode: "INDEX_FAILED" });
  await vi.waitFor(() => expect(f.reservation.signal.aborted).toBe(true));
  expect(f.calls).not.toContain("shared-knowledge-receipt-close");
  startup.resolve(f.worker); await rejected;
  expect(f.worker.stop).toHaveBeenCalledOnce(); expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
});

it("rejects a cancelled worker even if a synthetic Main reply claims verification success", async () => {
  const f = fixture(), run = f.run(), rejected = expect(run).rejects.toThrow();
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  f.native.resolve("cancelled"); f.finish();
  await rejected; expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
});

it("rejects ordinary port reservations and stops them without spawning", async () => {
  const f = fixture(); f.reservation.phase = "port";
  await expect(f.run()).rejects.toThrow();
  expect(f.start).not.toHaveBeenCalled(); expect(f.reservation.stop).toHaveBeenCalledOnce();
});

it.each(["prepare", "register", "start", "close"])("never reports success after %s failure", async phase => {
  const f = fixture(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (message, signal) => {
    if (message.type === `shared-knowledge-index-${phase}` || phase === "close" && message.type === "shared-knowledge-receipt-close") {
      return { type: phase === "close" ? "shared-knowledge-receipt-close-result" : phase === "prepare" ? "shared-knowledge-index-prepare-result" : "shared-knowledge-index-register-result", requestId: "failure", ok: false, errorCode: "PERSISTENCE_FAILED" };
    }
    return original(message, signal);
  });
  if (phase === "start") f.start.mockRejectedValue(new Error("Synthetic startup failure"));
  const run = f.run(), rejected = expect(run).rejects.toThrow();
  if (phase === "close") { await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce()); f.finish(); }
  await rejected;
  if (phase === "prepare") expect(f.reserve).not.toHaveBeenCalled();
  if (phase === "register") expect(f.start).not.toHaveBeenCalled();
});

it("closes a late prepared handle after cancellation without reserving or starting", async () => {
  const f = fixture(), prepared = deferred<SharedKnowledgeReceiptResult>(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation((message, signal) => message.type === "shared-knowledge-index-prepare" ? prepared.promise : original(message, signal));
  const run = f.run(), rejected = expect(run).rejects.toThrow();
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
  f.caller.abort(); prepared.resolve({ type: "shared-knowledge-index-prepare-result", requestId: "late", ok: true, indexId: id });
  await rejected; expect(f.reserve).not.toHaveBeenCalled(); expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
});

it("keeps the handle open through post-index verification and cancels on a stale head", async () => {
  const f = fixture(), observation = deferred<() => void>();
  f.revalidate.mockReturnValue(observation.promise);
  const run = f.run(), rejected = expect(run).rejects.toThrow("Synthetic stale head");
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce()); f.finish();
  await vi.waitFor(() => expect(f.revalidate).toHaveBeenCalledOnce());
  expect(f.calls).not.toContain("shared-knowledge-receipt-close");
  observation.reject(new Error("Synthetic stale head")); await rejected;
  expect(f.calls).toContain("shared-knowledge-index-cancel"); expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
  expect(f.start).toHaveBeenCalledOnce();
});

it("rechecks the observation after closing and does not report success if it expired during cleanup", async () => {
  const f = fixture(), validate = vi.fn(() => undefined); f.revalidate.mockResolvedValue(validate);
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (message, signal) => {
    if (message.type === "shared-knowledge-receipt-close") validate.mockImplementation(() => { throw new Error("Synthetic expired observation"); });
    return original(message, signal);
  });
  const run = f.run(), rejected = expect(run).rejects.toMatchObject({ outcome: "indeterminate" });
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce()); f.finish(); await rejected;
  expect(validate).toHaveBeenCalledTimes(2); expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
});

it("rejects a late successful observation after caller cancellation", async () => {
  const f = fixture(), observation = deferred<() => void>(); f.revalidate.mockReturnValue(observation.promise);
  const run = f.run(), rejected = expect(run).rejects.toThrow();
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce()); f.finish();
  await vi.waitFor(() => expect(f.revalidate).toHaveBeenCalledOnce());
  f.caller.abort(); observation.resolve(() => undefined); await rejected;
  expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
});

it.each(["denied", "indeterminate", "lost-reply", "wrong-operation", "wrong-epoch", "wrong-cursor", "abort-on-ack", "identity-on-close", "cleanup-throws"])("preserves publication outcome for %s without retry", async mode => {
  const f = fixture(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (message, signal) => {
    if (message.type === "shared-knowledge-index-publish") {
      if (mode === "denied" || mode === "indeterminate") return { type: "shared-knowledge-index-publish-result", requestId: "pub", ok: false,
        errorCode: mode === "denied" ? "SCOPE_DENIED" : "PUBLICATION_INDETERMINATE" };
      if (mode === "lost-reply" || mode === "cleanup-throws") throw new Error("Synthetic lost reply");
      if (mode === "wrong-operation") return { type: "shared-knowledge-receipt-close-result", requestId: "pub", ok: true };
      if (mode === "abort-on-ack") f.caller.abort();
      return { type: "shared-knowledge-index-publish-result", requestId: "pub", ok: true, state: "published-local", snapshot: {
        epoch: mode === "wrong-epoch" ? "00000000-0000-4000-8000-000000000002" : id, cursor: mode === "wrong-cursor" ? "8" : "7" } };
    }
    if (mode === "identity-on-close" && message.type === "shared-knowledge-receipt-close") f.identity.abort();
    return original(message, signal);
  });
  if (mode === "cleanup-throws") vi.spyOn(f.reservation, "stop").mockImplementation(() => { throw new Error("Synthetic cleanup failure"); });
  const run = f.run();
  const rejected = run.catch((error: unknown) => error);
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce()); f.finish();
  const error = await rejected;
  expect(error).toBeInstanceOf(Error);
  if (mode === "denied") expect(error).not.toHaveProperty("outcome");
  else expect(error).toMatchObject({ outcome: "indeterminate" });
  expect(f.request.mock.calls.filter(([message]) => message.type === "shared-knowledge-index-publish")).toHaveLength(1);
});

it("does not publish before a successful current early observation", async () => {
  const f = fixture(); f.revalidate.mockRejectedValue(new Error("Synthetic stale head"));
  const run = f.run(), rejected = expect(run).rejects.toThrow("Synthetic stale head");
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce()); f.finish(); await rejected;
  expect(f.calls).not.toContain("shared-knowledge-index-publish");
});
