import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SharedKnowledgeReceiptStore } from "./shared-knowledge-receipt-store.js";

const roots: string[] = [];
const faults = vi.hoisted(() => ({ pointerRename: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: async (...args: Parameters<typeof actual.rename>) => {
    if (faults.pointerRename && String(args[1]).endsWith("/receipt.json")) throw new Error("Synthetic pointer rename failure");
    return actual.rename(...args);
  } };
});
const key = "a".repeat(64), epoch = "00000000-0000-0000-0000-000000000001";
afterEach(async () => { faults.pointerRename = false; await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-receipt-test-")); roots.push(root);
  return { root, store: new SharedKnowledgeReceiptStore(root, key) };
}
const batch = (fromCursor: string, toCursor: string, body = "synthetic receipt") => ({ epoch, fromCursor, toCursor, bytes: new TextEncoder().encode(body) });

it("serializes separate store instances across binding generations without lost cursor updates", async () => {
  const { root, store } = await fixture();
  const replacement = new SharedKnowledgeReceiptStore(join(root, "unused", ".."), key);
  const results = await Promise.allSettled([
    store.append(batch("0", "1", "old generation")),
    replacement.append(batch("0", "1", "new generation conflict")),
    replacement.append(batch("1", "2", "new generation continuation"))
  ]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  expect((await store.verifyHistory(2)).pages).toBe(2);
  expect((await replacement.read())?.cursor).toBe("2");
});

it("bounds process-wide queued work and releases capacity after completion", async () => {
  const { root, store } = await fixture();
  const pending = Array.from({ length: 16 }, (_, index) => new SharedKnowledgeReceiptStore(root, key).append(batch(String(index), String(index + 1))));
  await expect(store.read()).rejects.toThrow("capacity exceeded");
  await Promise.all(pending);
  expect((await store.read())?.cursor).toBe("16");
  expect((await store.verifyHistory(16)).pages).toBe(16);
});

it("replays exact bytes oldest-first and permits queued writes without extending the captured snapshot", async () => {
  const { store } = await fixture();
  await store.append(batch("0", "1", "first 中文"));
  const pointer = await store.append(batch("1", "2", "second"));
  const staged: string[] = [];
  const result = await store.replayHistory(2, async (receipt) => {
    staged.push(`${receipt.fromCursor}:${receipt.toCursor}:${new TextDecoder().decode(receipt.bytes)}`);
    expect(receipt.epoch).toBe(epoch);
    if (receipt.fromCursor === "0") await store.append(batch("2", "3", "later"));
    receipt.bytes.fill(0);
  });
  expect(staged).toEqual(["0:1:first 中文", "1:2:second"]);
  expect(result).toEqual({ pointer, pages: 2 });
  expect((await store.read())?.cursor).toBe("3");
  expect((await store.verifyHistory(3)).pages).toBe(3);
});

it("does not stage any pages before the entire captured chain passes validation", async () => {
  const { root, store } = await fixture();
  const first = await store.append(batch("0", "1"));
  await store.append(batch("1", "2"));
  const stage = vi.fn(async () => {});
  await expect(store.replayHistory(1, stage)).rejects.toThrow("budget exceeded");
  await unlink(join(root, key, `${first.record}.json`));
  await expect(store.replayHistory(2, stage)).rejects.toThrow();
  expect(stage).not.toHaveBeenCalled();
});

it("revalidates each staged record if a later file changes after preflight", async () => {
  const { root, store } = await fixture();
  await store.append(batch("0", "1"));
  const pointer = await store.append(batch("1", "2"));
  const stage = vi.fn(async () => {
    await writeFile(join(root, key, `${pointer.record}.json`), "corrupt after preflight");
  });
  await expect(store.replayHistory(2, stage)).rejects.toThrow("corrupt");
  expect(stage).toHaveBeenCalledTimes(1);
});

it.each(["cancel", "failure"])("stops on staging %s without certifying completion or changing progress", async (failure) => {
  const { store } = await fixture();
  await store.append(batch("0", "1"));
  const pointer = await store.append(batch("1", "2"));
  const controller = new AbortController();
  const stage = vi.fn(async (_receipt, signal) => {
    expect(signal).toBe(controller.signal);
    if (failure === "cancel") controller.abort(new Error("Staging cancelled"));
    else throw new Error("Staging failed");
  });
  await expect(store.replayHistory(2, stage, controller.signal)).rejects.toThrow("Staging");
  expect(stage).toHaveBeenCalledTimes(1);
  expect(await store.read()).toEqual(pointer);
  const retry = vi.fn(async () => {});
  expect(await store.replayHistory(2, retry)).toEqual({ pointer, pages: 2 });
  expect(retry).toHaveBeenCalledTimes(2);
});

it("replays empty history without staging and rejects invalid replay budgets", async () => {
  const { store } = await fixture();
  const stage = vi.fn(async () => {});
  expect(await store.replayHistory(1, stage)).toEqual({ pointer: undefined, pages: 0 });
  for (const budget of [0, 1.5, 10_001, Infinity]) {
    await expect(store.replayHistory(budget, stage)).rejects.toThrow("budget");
  }
  expect(stage).not.toHaveBeenCalled();
});

it("persists pages before pointers, survives reopen and keeps exact retries idempotent", async () => {
  const { root, store } = await fixture();
  expect(await store.read()).toBeUndefined();
  const first = await store.append(batch("0", "1"));
  expect(await new SharedKnowledgeReceiptStore(root, key).read()).toEqual(first);
  expect(await store.append(batch("0", "1"))).toEqual(first);
  const second = await store.append(batch("1", "2", "next"));
  const record = JSON.parse(await readFile(join(root, key, `${second.record}.json`), "utf8"));
  expect(record.previous).toBe(first.record);
  expect(Buffer.from(record.payload, "base64").toString()).toBe("next");
  expect(await readFile(join(root, key, `${first.record}.json`), "utf8")).toContain("payload");
});
it("serializes conflicting writers and rejects stale cursor, epoch and retry payload", async () => {
  const { store } = await fixture();
  const results = await Promise.allSettled([store.append(batch("0", "1")), store.append(batch("0", "2"))]);
  expect(results.map((value) => value.status)).toEqual(["fulfilled", "rejected"]);
  await expect(store.append(batch("0", "1", "different"))).rejects.toThrow();
  await expect(store.append({ ...batch("1", "2"), epoch: "00000000-0000-0000-0000-000000000002" })).rejects.toThrow();
  expect((await store.read())?.cursor).toBe("1");
});
it("rejects missing or corrupt committed pages rather than resetting progress", async () => {
  const { root, store } = await fixture();
  const committed = await store.append(batch("0", "1"));
  await writeFile(join(root, key, `${committed.record}.json`), "corrupt");
  await expect(store.read()).rejects.toThrow();
  await unlink(join(root, key, `${committed.record}.json`));
  await expect(store.read()).rejects.toThrow();
});
it("leaves progress unchanged when pointer publication fails", async () => {
  const { root, store } = await fixture();
  const first = await store.append(batch("0", "1"));
  faults.pointerRename = true;
  await expect(store.append(batch("1", "2"))).rejects.toThrow();
  expect(await store.read()).toEqual(first);
  expect((await readdir(join(root, key))).filter((name) => name.endsWith(".json"))).toHaveLength(3);
  faults.pointerRename = false;
  expect((await store.append(batch("1", "2"))).cursor).toBe("2");
});
it("separates namespaces and bounds input without changing state", async () => {
  const { root, store } = await fixture();
  await store.append(batch("0", "1"));
  expect(await new SharedKnowledgeReceiptStore(root, "b".repeat(64)).read()).toBeUndefined();
  await expect(store.append({ ...batch("1", "2"), bytes: new Uint8Array(2 * 1024 * 1024 + 1) })).rejects.toThrow();
  await expect(store.append(batch("1", "1"))).rejects.toThrow();
  expect((await store.read())?.cursor).toBe("1");
});

it("verifies history to zero and rejects budget exhaustion without changing progress", async () => {
  const { store } = await fixture();
  expect(await store.verifyHistory(1)).toEqual({ pointer: undefined, pages: 0 });
  await store.append(batch("0", "1"));
  await store.append(batch("1", "2"));
  const pointer = await store.append(batch("2", "3"));
  await expect(store.verifyHistory(2)).rejects.toThrow("budget exceeded");
  expect(await store.verifyHistory(3)).toEqual({ pointer, pages: 3 });
  expect(await store.read()).toEqual(pointer);
  await expect(store.verifyHistory(0)).rejects.toThrow("budget");
});

it.each(["missing", "corrupt"])("rejects %s older records despite a valid tail", async (failure) => {
  const { root, store } = await fixture();
  const first = await store.append(batch("0", "1"));
  await store.append(batch("1", "2"));
  const pointer = await store.append(batch("2", "3"));
  const path = join(root, key, `${first.record}.json`);
  if (failure === "missing") await unlink(path);
  else await writeFile(path, "corrupt");
  expect(await store.read()).toEqual(pointer);
  await expect(store.verifyHistory(3)).rejects.toThrow();
});

it.each(["gap", "epoch", "truncated", "base64"])("rejects hash-valid %s envelope corruption", async (failure) => {
  const { root, store } = await fixture();
  await store.append(batch("0", "1"));
  const pointer = await store.append(batch("1", "3"));
  const record = JSON.parse(await readFile(join(root, key, `${pointer.record}.json`), "utf8"));
  if (failure === "gap") record.fromCursor = "2";
  if (failure === "epoch") record.epoch = "00000000-0000-0000-0000-000000000002";
  if (failure === "truncated") record.previous = null;
  if (failure === "base64") record.payload += "!";
  const content = JSON.stringify(record);
  const hash = createHash("sha256").update(content).digest("hex");
  await writeFile(join(root, key, `${hash}.json`), content);
  await writeFile(join(root, key, "receipt.json"), JSON.stringify({ ...pointer, epoch: record.epoch, record: hash }));
  await expect(store.verifyHistory(3)).rejects.toThrow();
});

it("honors cancellation before and during traversal without poisoning the writer queue", async () => {
  const { store } = await fixture();
  await store.append(batch("0", "1"));
  await store.append(batch("1", "2"));
  const controller = new AbortController();
  controller.abort(new Error("Synthetic cancellation"));
  await expect(store.verifyHistory(2, controller.signal)).rejects.toThrow("Synthetic cancellation");
  const running = new AbortController();
  let checks = 0;
  const original = running.signal.throwIfAborted.bind(running.signal);
  vi.spyOn(running.signal, "throwIfAborted").mockImplementation(() => {
    if (++checks === 5) running.abort(new Error("Traversal cancelled"));
    original();
  });
  await expect(store.verifyHistory(2, running.signal)).rejects.toThrow("Traversal cancelled");
  expect((await store.append(batch("2", "3"))).cursor).toBe("3");
  expect((await store.verifyHistory(3)).pages).toBe(3);
});
