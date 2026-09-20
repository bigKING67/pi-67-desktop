import { afterEach, expect, it, vi } from "vitest";
import type { SharedKnowledgeReceiptRequest } from "@pi67/protocol";
import { SharedKnowledgeReceiptClient } from "./shared-knowledge-receipt-client.js";

const id = "00000000-0000-4000-8000-000000000001";
const identity = { userId: "user", endpoint: "https://fixture.invalid" };
const open = { type: "shared-knowledge-receipt-open" as const, scope: { teamId: id, scopeKind: "team" as const, scopeId: id } };
afterEach(() => { vi.useRealTimers(); });
function fixture() {
  const messages: SharedKnowledgeReceiptRequest[] = [];
  const client = new SharedKnowledgeReceiptClient({ postMessage: (message) => { messages.push(message); } }, identity, 20);
  return { messages, client };
}
const opened = (requestId: string) => ({ type: "shared-knowledge-receipt-open-result", requestId, ok: true,
  ...identity, handleId: id, progress: { epoch: null, cursor: "0" } });
const index = () => ({ type: "shared-knowledge-index-prepare" as const, handleId: id, models: {
  embedding: { endpoint: "https://models.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://models.invalid/v1", model: "extract" }
} });

it.each(["prepare", "query", "read", "current"].flatMap(phase => ["cancel", "timeout", "shutdown"].map(mode => ({ phase, mode }))))("closes the dedicated $phase receipt on $mode and rejects late replies", async ({ phase, mode }) => {
  vi.useFakeTimers(); const { client, messages } = fixture(), caller = new AbortController();
  const input = phase === "prepare" ? { type: "shared-knowledge-index-query-prepare" as const, handleId: id }
    : phase === "current" ? { type: "shared-knowledge-index-read-current" as const, handleId: id, assetId: id, contentRevision: "a".repeat(64) }
    : phase === "read" ? { type: "shared-knowledge-index-read" as const, handleId: id, snapshot: { epoch: id, cursor: "1" }, assetId: id, contentRevision: "a".repeat(64) }
      : { type: "shared-knowledge-index-query" as const, handleId: id, queryId: id, vector: [1, 2, 3, 4], limit: 4 };
  const pending = client.request(input, caller.signal), rejected = expect(pending).rejects.toThrow();
  if ("vector" in input) input.vector[0] = 999;
  await vi.advanceTimersByTimeAsync(60_000); expect(messages).toHaveLength(1);
  if ("vector" in messages[0]!) expect(messages[0].vector[0]).toBe(1);
  if (mode === "cancel") caller.abort(); else if (mode === "shutdown") client.shutdown(); else await vi.advanceTimersByTimeAsync(10_000);
  await rejected; expect(messages[1]).toMatchObject({ type: "shared-knowledge-receipt-close", handleId: id });
  expect(client.handleResult({ type: `${input.type}-result`, requestId: messages[0]!.requestId, ok: false, errorCode: "QUERY_FAILED" })).toBe(false);
  client.shutdown();
});

it.each(["success", "timeout", "cancel"])("bounds publish waiting independently of receipt IO: %s", async mode => {
  vi.useFakeTimers(); const { client, messages } = fixture(), lifetime = new AbortController();
  const pending = client.request({ type: "shared-knowledge-index-publish", handleId: id, indexId: id }, lifetime.signal);
  const rejection = mode === "success" ? undefined : expect(pending).rejects.toMatchObject({ outcome: "indeterminate" });
  await vi.advanceTimersByTimeAsync(90_000); expect(messages).toHaveLength(1);
  const response = { type: "shared-knowledge-index-publish-result", requestId: messages[0]!.requestId, ok: true, state: "published-local", snapshot: { epoch: id, cursor: "7" } };
  if (mode === "success") { expect(client.handleResult(response)).toBe(true); expect(await pending).toEqual(response); }
  else {
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(10_000); else lifetime.abort();
    await rejection;
    expect(messages.at(-1)).toMatchObject({ type: "shared-knowledge-receipt-close", handleId: id });
    expect(client.handleResult(response)).toBe(false);
  }
  client.shutdown(); expect(vi.getTimerCount()).toBe(0);
});

it("preserves Main's indeterminate result without treating it as retryable success", async () => {
  const { client, messages } = fixture();
  const pending = client.request({ type: "shared-knowledge-index-publish", handleId: id, indexId: id });
  const response = { type: "shared-knowledge-index-publish-result", requestId: messages[0]!.requestId, ok: false, errorCode: "PUBLICATION_INDETERMINATE" };
  expect(client.handleResult(response)).toBe(true); expect(await pending).toEqual(response);
  expect(messages).toHaveLength(1); client.shutdown();
});

it("allows bounded Main index preparation beyond receipt IO timeout and snapshots model selection", async () => {
  vi.useFakeTimers();
  const { client, messages } = fixture(), input = index();
  const pending = client.request(input); input.models.embedding.model = "mutated";
  await vi.advanceTimersByTimeAsync(60_000);
  expect(messages).toHaveLength(1); expect(messages[0]).toMatchObject(index());
  const ready = { type: "shared-knowledge-index-prepare-result", requestId: messages[0]!.requestId, ok: true, indexId: id };
  expect(client.handleResult(ready)).toBe(true); expect(await pending).toEqual(ready);
  client.shutdown();
});

it.each(["cancel", "timeout", "shutdown", "mismatch"])("closes the exact index handle after %s without accepting late preparation", async mode => {
  vi.useFakeTimers();
  const { client, messages } = fixture(), abort = new AbortController();
  const pending = client.request(index(), abort.signal), rejected = expect(pending).rejects.toThrow();
  if (mode === "cancel") abort.abort();
  if (mode === "timeout") await vi.advanceTimersByTimeAsync(70_000);
  if (mode === "shutdown") client.shutdown();
  if (mode === "mismatch") client.handleResult({ type: "shared-knowledge-index-register-result", requestId: messages[0]!.requestId, ok: true });
  await rejected;
  expect(messages[1]).toMatchObject({ type: "shared-knowledge-receipt-close", handleId: id });
  expect(client.handleResult({ type: "shared-knowledge-index-prepare-result", requestId: messages[0]!.requestId, ok: true, indexId: id })).toBe(false);
  client.shutdown();
});

it("retires the index handle if register acknowledgement is lost", async () => {
  vi.useFakeTimers();
  const { client, messages } = fixture();
  const pending = client.request({ type: "shared-knowledge-index-register", handleId: id, indexId: id, workerRequestId: id });
  const rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(20); await rejected;
  expect(messages[1]).toMatchObject({ type: "shared-knowledge-receipt-close", handleId: id });
  client.shutdown();
});

it("waits for Main verification separately from startup and caps that wait", async () => {
  vi.useFakeTimers();
  const { client, messages } = fixture();
  const pending = client.request({ type: "shared-knowledge-index-wait", handleId: id, indexId: id });
  const rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(399_999); expect(messages).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); await rejected;
  expect(messages[1]).toMatchObject({ type: "shared-knowledge-receipt-close", handleId: id });
  client.shutdown();
});

it("correlates valid results exactly once and snapshots outgoing scope", async () => {
  const { client, messages } = fixture();
  const input = { ...open, scope: { ...open.scope } };
  const pending = client.request(input); input.scope.teamId = "changed";
  expect(messages[0]).toMatchObject(open);
  expect(client.handleResult(opened("unknown"))).toBe(false);
  const response = opened(messages[0]!.requestId);
  expect(client.handleResult(response)).toBe(true);
  expect(client.handleResult(response)).toBe(false);
  expect(await pending).toEqual(response);
});

it.each(["userId", "endpoint"])("rejects %s mismatch and best-effort closes the rejected Main handle", async (field) => {
  const { client, messages } = fixture();
  const pending = client.request(open);
  client.handleResult({ ...opened(messages[0]!.requestId), [field]: "other" });
  await expect(pending).rejects.toThrow("identity mismatch");
  expect(messages[1]).toMatchObject({ type: "shared-knowledge-receipt-close", handleId: id });
});

it("bounds abandoned opens and recovers capacity when a late reply can be cleaned up", async () => {
  vi.useFakeTimers();
  const { client, messages } = fixture();
  for (let batch = 0; batch < 8; batch += 1) {
    const pending = Promise.allSettled(Array.from({ length: 16 }, () => client.request(open)));
    await vi.advanceTimersByTimeAsync(20);
    expect((await pending).every((item) => item.status === "rejected")).toBe(true);
  }
  await expect(client.request(open)).rejects.toThrow("capacity");
  expect(messages).toHaveLength(128);
  client.handleResult(opened(messages[0]!.requestId));
  const retry = client.request(open), requestId = messages.at(-1)!.requestId;
  client.handleResult({ type: "shared-knowledge-receipt-open-result", requestId, ok: false, errorCode: "NOT_SIGNED_IN" });
  await expect(retry).resolves.toMatchObject({ ok: false });
});

it("rejects wrong operation replies and cleans up a later valid open", async () => {
  const { client, messages } = fixture();
  const pending = client.request(open), requestId = messages[0]!.requestId;
  client.handleResult({ type: "shared-knowledge-receipt-close-result", requestId, ok: true });
  await expect(pending).rejects.toThrow("operation mismatch");
  expect(client.handleResult(opened(requestId))).toBe(true);
  expect(messages[1]).toMatchObject({ type: "shared-knowledge-receipt-close", handleId: id });
});

it("times out without retrying and closes a late successful open", async () => {
  vi.useFakeTimers();
  const { client, messages } = fixture();
  const pending = client.request(open), rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(20); await rejected;
  expect(messages).toHaveLength(1);
  client.handleResult(opened(messages[0]!.requestId));
  expect(messages).toHaveLength(2);
  expect(messages[1]?.type).toBe("shared-knowledge-receipt-close");
});

it("cancels before send or while pending and rejects new work after shutdown", async () => {
  const { client, messages } = fixture();
  const early = new AbortController(); early.abort();
  await expect(client.request(open, early.signal)).rejects.toThrow("cancelled");
  expect(messages).toHaveLength(0);
  const running = new AbortController(), pending = client.request(open, running.signal);
  running.abort(); await expect(pending).rejects.toThrow("cancelled");
  const lifetime = client.signal;
  expect(lifetime.aborted).toBe(false);
  const next = client.request(open); client.shutdown();
  expect(lifetime.aborted).toBe(true);
  expect(client.signal).toBe(lifetime);
  await expect(next).rejects.toThrow("shutting down");
  await expect(client.request(open)).rejects.toThrow("stopped");
  client.handleResult(opened(messages[1]!.requestId));
  expect(messages[2]?.type).toBe("shared-knowledge-receipt-close");
});

it("bounds pending requests and returns typed failures without turning them into success", async () => {
  const { client, messages } = fixture();
  const requests = Array.from({ length: 16 }, () => client.request(open));
  await expect(client.request(open)).rejects.toThrow("capacity");
  for (const message of messages) client.handleResult({ type: "shared-knowledge-receipt-open-result",
    requestId: message.requestId, ok: false, errorCode: "SCOPE_DENIED" });
  for (const result of await Promise.all(requests)) expect(result).toMatchObject({ ok: false, errorCode: "SCOPE_DENIED" });
});

it("rejects bad outbound payloads and transport failure without exposing the thrown payload", async () => {
  const { client, messages } = fixture();
  await expect(client.request({ ...open, scope: { ...open.scope, scopeId: "wrong" } })).rejects.toThrow("Invalid");
  expect(messages).toHaveLength(0);
  const broken = new SharedKnowledgeReceiptClient({ postMessage: () => { throw new Error("synthetic private payload"); } }, identity);
  await expect(broken.request(open)).rejects.toThrow("parent channel is unavailable");
});
