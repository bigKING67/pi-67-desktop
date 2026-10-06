import type { TeamChatAttachment } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import { createTeamChatUploads } from "./team-chat-uploads.js";

const MiB = 1024 * 1024;

function file(name: string, size: number, type = "") {
  return new File([new Uint8Array(size)], name, { type });
}

function setup(options: { failFinish?: boolean; gate?: Promise<void> } = {}) {
  const calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let next = 0;
  let failFinish = options.failFinish ?? false;
  const request = vi.fn(async (type: string, payload: Record<string, unknown>) => {
    calls.push({ type, payload });
    switch (type) {
      case "teamChat.attachment.begin": {
        next += 1;
        const attachment: TeamChatAttachment = { id: `a${next}`, fileName: payload.fileName as string, contentType: "x", byteSize: payload.byteSize as number };
        return { attachment };
      }
      case "teamChat.attachment.chunk":
        await options.gate;
        return { received: (payload.offset as number) + (payload.data as ArrayBuffer).byteLength };
      case "teamChat.attachment.finish":
        if (failFinish) {
          failFinish = false;
          throw Object.assign(new Error("x"), { details: { serviceError: "chat_attachment_storage_unavailable" } });
        }
        return { attachment: { id: payload.attachmentId, fileName: "f", contentType: "x", byteSize: 1 } };
      default:
        return {};
    }
  });
  const revoked: string[] = [];
  let urls = 0;
  const uploads = createTeamChatUploads({
    request: request as never,
    measure: async () => ({ width: 4, height: 3 }),
    createObjectUrl: () => `blob:${(urls += 1)}`,
    revokeObjectUrl: (url) => { revoked.push(url); },
    newId: (() => { let id = 0; return () => `local-${(id += 1)}`; })()
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const idle = async () => { for (let index = 0; index < 20; index += 1) await settle(); };
  return { uploads, calls, revoked, idle };
}

describe("Team Chat uploads", () => {
  it("uploads one file at a time in 1 MiB chunks and hands stored files to the message", async () => {
    const { uploads, calls, idle } = setup();
    expect(uploads.add("c1", [file("图.png", 2 * MiB + 5, "image/png"), file("表.xlsx", 3)])).toEqual([]);
    expect(uploads.take("c1")).toBeUndefined();
    await idle();
    expect(calls.map((call) => call.type)).toEqual([
      "teamChat.attachment.begin", "teamChat.attachment.chunk", "teamChat.attachment.chunk", "teamChat.attachment.chunk",
      "teamChat.attachment.finish",
      "teamChat.attachment.begin", "teamChat.attachment.chunk", "teamChat.attachment.finish"
    ]);
    expect(calls[0]!.payload).toEqual({ conversationId: "c1", fileName: "图.png", byteSize: 2 * MiB + 5, width: 4, height: 3 });
    expect(calls[5]!.payload).toEqual({ conversationId: "c1", fileName: "表.xlsx", byteSize: 3 });
    expect(calls.filter((call) => call.type === "teamChat.attachment.chunk").map((call) => call.payload.offset)).toEqual([0, MiB, 2 * MiB, 0]);
    const ready = uploads.store.getState().uploads;
    expect(ready.map((item) => [item.status, item.sentBytes])).toEqual([["ready", 2 * MiB + 5], ["ready", 3]]);
    expect(uploads.take("c1")?.map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(uploads.store.getState().uploads).toEqual([]);
    expect(uploads.sentPreview("a1")).toBe("blob:1");
  });

  it("refuses executables, oversized files and the eleventh file, keeping the rest", () => {
    const { uploads } = setup();
    const many = Array.from({ length: 10 }, (_, index) => file(`${index}.txt`, 1));
    const refused = uploads.add("c1", [file("setup.exe", 1), file("big.zip", 26 * MiB), ...many, file("extra.txt", 1)]);
    expect(refused).toEqual([
      { fileName: "setup.exe", reason: "type" },
      { fileName: "big.zip", reason: "size" },
      { fileName: "extra.txt", reason: "count" }
    ]);
    expect(uploads.store.getState().uploads).toHaveLength(10);
    uploads.clear();
  });

  it("marks a failed upload, discards its grant and retries from the start", async () => {
    const { uploads, calls, idle } = setup({ failFinish: true });
    uploads.add("c1", [file("a.txt", 2)]);
    await idle();
    const [failed] = uploads.store.getState().uploads;
    expect(failed).toMatchObject({ status: "failed", error: "附件存储暂时不可用，请稍后重试。" });
    expect(calls.at(-1)).toEqual({ type: "teamChat.attachment.discard", payload: { attachmentId: "a1" } });
    expect(uploads.take("c1")).toBeUndefined();
    uploads.retry(failed!.localId);
    await idle();
    expect(uploads.store.getState().uploads[0]).toMatchObject({ status: "ready" });
    expect(uploads.store.getState().uploads[0]).not.toHaveProperty("error");
  });

  it("stops and discards a removed upload, and clears everything on sign-out", async () => {
    let open = () => undefined as void;
    const { uploads, calls, revoked, idle } = setup({ gate: new Promise<void>((resolve) => { open = resolve; }) });
    uploads.add("c1", [file("a.png", 3 * MiB, "image/png")]);
    uploads.add("c2", [file("b.png", 1, "image/png")]);
    const [first] = uploads.store.getState().uploads;
    while (!calls.some((call) => call.type === "teamChat.attachment.chunk")) await new Promise((resolve) => setTimeout(resolve, 0));
    uploads.remove(first!.localId);
    open();
    await idle();
    expect(calls.some((call) => call.type === "teamChat.attachment.discard" && call.payload.attachmentId === "a1")).toBe(true);
    expect(calls.some((call) => call.type === "teamChat.attachment.finish" && call.payload.attachmentId === "a1")).toBe(false);
    expect(revoked).toEqual(["blob:1"]);
    expect(uploads.take("c2")).toHaveLength(1);
    uploads.clear();
    expect(revoked).toEqual(["blob:1", "blob:2"]);
    expect(uploads.sentPreview("a2")).toBeUndefined();
  });
});
