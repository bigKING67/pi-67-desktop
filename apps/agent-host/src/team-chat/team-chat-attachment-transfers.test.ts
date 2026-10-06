import type { TeamChatAttachment } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import { TeamChatAttachmentTransfers } from "./team-chat-attachment-transfers.js";

const attachment = (id: string, byteSize: number): TeamChatAttachment =>
  ({ id, fileName: `${id}.png`, contentType: "image/png", byteSize });
const upload = { url: "https://s3.example.test/bucket/chat/t/a?X-Amz-Signature=x", contentType: "image/png" };
const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe("TeamChatAttachmentTransfers", () => {
  it("assembles in-order chunks and PUTs the exact bytes with the granted content type", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const transfers = new TeamChatAttachmentTransfers(fetchImpl as unknown as typeof fetch);
    transfers.begin(attachment("a", 4), upload);
    expect(transfers.chunk("a", 0, bytes(1, 2))).toBe(2);
    expect(() => transfers.chunk("a", 3, bytes(9))).toThrow(/in order/);
    expect(() => transfers.chunk("a", 2, bytes(3, 4, 5))).toThrow(/in order/);
    await expect(transfers.finish("a")).rejects.toThrow(/incomplete/);
    expect(transfers.chunk("a", 2, bytes(3, 4))).toBe(4);
    await expect(transfers.finish("a")).resolves.toMatchObject({ id: "a" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(upload.url);
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "content-type": "image/png" });
    expect([...(init.body as Uint8Array)]).toEqual([1, 2, 3, 4]);
    expect(() => transfers.chunk("a", 0, bytes(1))).toThrow(/No upload/);
  });

  it("refuses insecure storage URLs and too much buffered data", () => {
    const transfers = new TeamChatAttachmentTransfers(vi.fn() as unknown as typeof fetch);
    expect(() => transfers.begin(attachment("a", 1), { url: "http://s3.example.test/x" })).toThrow(/not secure/);
    expect(() => transfers.begin(attachment("b", 1), { url: "http://127.0.0.1:9000/x" })).not.toThrow();
    transfers.discard("b");
    for (const id of ["c", "d", "e", "f"]) transfers.begin(attachment(id, 25 * 1024 * 1024), upload);
    expect(() => transfers.begin(attachment("g", 1), upload)).toThrow(/at once/);
    transfers.discard("c");
    expect(() => transfers.begin(attachment("g", 1), upload)).not.toThrow();
  });

  it("surfaces a failed store as the storage-unavailable service error and forgets the upload", async () => {
    const transfers = new TeamChatAttachmentTransfers(vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch);
    transfers.begin(attachment("a", 1), upload);
    transfers.chunk("a", 0, bytes(7));
    await expect(transfers.finish("a")).rejects.toMatchObject({ details: { serviceError: "chat_attachment_storage_unavailable" } });
    expect(() => transfers.chunk("a", 0, bytes(7))).toThrow(/No upload/);
  });

  it("downloads once and serves bounded chunks from the cache until cleared", async () => {
    const body = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
    const fetchImpl = vi.fn(async () => new Response(body, { headers: { "content-type": "image/png; charset=binary" } }));
    const download = vi.fn(async () => ({ url: upload.url }));
    const transfers = new TeamChatAttachmentTransfers(fetchImpl as unknown as typeof fetch);
    const first = await transfers.read("a", 0, 10 * 1024 * 1024, download);
    expect(first).toMatchObject({ contentType: "image/png", byteLength: body.byteLength, offset: 0, done: false });
    expect(first.data.byteLength).toBe(1024 * 1024);
    const last = await transfers.read("a", 2 * 1024 * 1024, 1024 * 1024, download);
    expect(last.done).toBe(true);
    expect(new Uint8Array(last.data)[0]).toBe(body[2 * 1024 * 1024]);
    expect(download).toHaveBeenCalledTimes(1);
    await expect(transfers.read("a", body.byteLength, 1, download)).rejects.toThrow(/past the end/);
    transfers.clear();
    await transfers.read("a", 0, 1, download);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("refuses failed or oversized downloads", async () => {
    const download = async () => ({ url: upload.url });
    const failing = new TeamChatAttachmentTransfers(vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch);
    await expect(failing.read("a", 0, 1, download)).rejects.toMatchObject({ details: { serviceError: "chat_attachment_storage_unavailable" } });
    const empty = new TeamChatAttachmentTransfers(vi.fn(async () => new Response(new Uint8Array(0))) as unknown as typeof fetch);
    await expect(empty.read("a", 0, 1, download)).rejects.toThrow(/not available/);
  });

  it("prefers the service's type, shares one download between concurrent reads and drops reads started before clear", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "text/html" } });
    });
    const download = vi.fn(async () => ({ url: upload.url, contentType: "image/png" }));
    const transfers = new TeamChatAttachmentTransfers(fetchImpl as unknown as typeof fetch);
    const reads = [transfers.read("a", 0, 1, download), transfers.read("a", 1, 2, download)];
    await Promise.resolve();
    transfers.clear();
    release();
    const [first, second] = await Promise.all(reads);
    expect(first?.contentType).toBe("image/png");
    expect(second?.done).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await transfers.read("a", 0, 1, download);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses bodies declared or streamed beyond the attachment limit before buffering them", async () => {
    const download = async () => ({ url: upload.url });
    const declared = new TeamChatAttachmentTransfers(vi.fn(async () => new Response(new Uint8Array(1),
      { headers: { "content-length": String(26 * 1024 * 1024) } })) as unknown as typeof fetch);
    await expect(declared.read("a", 0, 1, download)).rejects.toThrow(/not available/);
    const streamed = new TeamChatAttachmentTransfers(vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024)); }
    }))) as unknown as typeof fetch);
    await expect(streamed.read("a", 0, 1, download)).rejects.toThrow(/not available/);
  });

  it("expires uploads abandoned past the grant's lifetime", () => {
    let now = 0;
    const transfers = new TeamChatAttachmentTransfers(vi.fn() as unknown as typeof fetch, () => now);
    for (const id of ["a", "b", "c", "d"]) transfers.begin(attachment(id, 25 * 1024 * 1024), upload);
    expect(() => transfers.begin(attachment("e", 1), upload)).toThrow(/at once/);
    now = 5 * 60_000 + 1;
    expect(() => transfers.begin(attachment("e", 1), upload)).not.toThrow();
    expect(() => transfers.chunk("a", 0, bytes(1))).toThrow(/No upload/);
  });
});
