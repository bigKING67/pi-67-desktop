import { afterEach, expect, it, vi } from "vitest";
import { readKnowledgeSyncResponse } from "./enterprise-knowledge-sync-transport.js";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import type { KnowledgeSyncExpectation } from "./enterprise-knowledge-sync-page.js";

const id = "00000000-0000-0000-0000-000000000001";
const expected: KnowledgeSyncExpectation = { teamId: id, scopeKind: "team", scopeId: id, epoch: null, cursor: "0", permissionRevision: "a".repeat(64), limit: 50 };
function payload() {
  return JSON.stringify({ teamId: id, scopeKind: "team", scopeId: id, epoch: null, nextCursor: "0", headCursor: "0", hasMore: false,
    issuedAt: "2026-09-11T00:00:00Z", leaseExpiresAt: "2026-09-11T00:05:00Z", permissionRevision: expected.permissionRevision, changes: [] });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("delivers exact owned wire bytes including BOM, whitespace and timestamp spelling", async () => {
  const wire = `\uFEFF\n ${payload().replace("00:00:00Z", "00:00:00.000+00:00")} \n`;
  const source = new TextEncoder().encode(wire);
  const result = await readKnowledgeSyncResponse(new Response(source, { headers: { "content-type": "application/json" } }), expected, new AbortController().signal);
  expect(result.bytes).toEqual(source);
  expect(result.bytes.buffer.byteLength).toBe(source.byteLength);
  expect(result.page.issuedAt).toBe(Date.parse("2026-09-11T00:00:00Z"));
  source.fill(0);
  expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(result.bytes)).toBe(wire);
});
it("snapshots scope expectations before awaiting streamed data", async () => {
  const mutable = { ...expected };
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } }), { headers: { "content-type": "application/json" } });
  const pending = readKnowledgeSyncResponse(response, mutable, new AbortController().signal);
  mutable.permissionRevision = "b".repeat(64);
  streamController.enqueue(new TextEncoder().encode(payload()));
  streamController.close();
  expect((await pending).page.permissionRevision).toBe(expected.permissionRevision);
});
it("never delivers raw bytes when page semantics fail validation", async () => {
  const response = new Response(payload().replace(expected.permissionRevision, "b".repeat(64)), { headers: { "content-type": "application/json" } });
  await expect(readKnowledgeSyncResponse(response, expected, new AbortController().signal)).rejects.toThrow();
});
it("accepts chunked JSON and preserves the exact authenticated team route", async () => {
  const encoded = new TextEncoder().encode(payload());
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoded.subarray(0, 30)); controller.enqueue(encoded.subarray(30)); controller.close();
  } }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  const client = new EnterpriseContextGatewayClient("https://example.com", "synthetic-token");
  const result = await client.syncKnowledge(expected);
  expect(result.page.headCursor).toBe("0");
  expect(result.bytes).toEqual(encoded);
  expect(fetcher.mock.calls[0]?.[0]).toBe(`https://example.com/v1/agent/teams/${id}/shared-assets/sync?cursor=0&limit=50`);
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer synthetic-token");
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
});
it("uses explicit project routes and never retries authorization or epoch conflicts", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(payload().replace('"scopeKind":"team"', '"scopeKind":"project"'), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  const client = new EnterpriseContextGatewayClient("https://example.com");
  await client.syncKnowledge({ ...expected, scopeKind: "project" });
  expect(fetcher.mock.calls[0]?.[0]).toBe(`https://example.com/v1/agent/teams/${id}/projects/${id}/shared-assets/sync?cursor=0&limit=50`);
  for (const status of [403, 409]) {
    fetcher.mockResolvedValueOnce(new Response(null, { status }));
    await expect(client.syncKnowledge(expected)).rejects.toThrow();
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("cancels oversized decoded bodies regardless of a small Content-Length", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.enqueue(new Uint8Array(1));
  }, cancel }), { headers: { "content-type": "application/json", "content-length": "1" } });
  await expect(readKnowledgeSyncResponse(response, expected, new AbortController().signal)).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
});
it("cancels a stalled body without returning a partial page", async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } });
  const pending = readKnowledgeSyncResponse(response, expected, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
});
it("rejects non-JSON responses and sync 428 instead of device pending", async () => {
  await expect(readKnowledgeSyncResponse(new Response(payload()), expected, new AbortController().signal)).rejects.toThrow();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 428 })));
  await expect(new EnterpriseContextGatewayClient("https://example.com").syncKnowledge(expected)).rejects.toThrow();
});
it("honors request timeout while reading and does not fetch for pre-aborted callers", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  const client = new EnterpriseContextGatewayClient("https://example.com");
  const assertion = expect(client.syncKnowledge(expected)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(8_001);
  await assertion;
  expect(cancel).toHaveBeenCalledOnce();
  const controller = new AbortController(); controller.abort();
  await expect(client.syncKnowledge(expected, controller.signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});
