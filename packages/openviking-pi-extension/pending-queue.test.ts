import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, listPending, replayPending } from "./shared/pending-queue.mjs";

describe("OpenViking durable outbox replay", () => {
  let root = "";
  let previous: string | undefined;

  beforeEach(async () => {
    previous = process.env.OPENVIKING_PENDING_DIR;
    root = await mkdtemp(join(tmpdir(), "pi67-ov-outbox-"));
    process.env.OPENVIKING_PENDING_DIR = root;
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.OPENVIKING_PENDING_DIR;
    else process.env.OPENVIKING_PENDING_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });

  it("acknowledges a crash-window replay without posting a duplicate message", async () => {
    const payload = {
      role: "user",
      content: "already accepted",
      source_message_ids: ["pi67:stable-source"],
    };
    await enqueue("addMessage", "session-1", payload);
    const fetchJSON = vi.fn(async (path: string) => {
      expect(path).toContain("/context?token_budget=128000");
      return { ok: true, result: { messages: [{ source_message_ids: ["pi67:stable-source"] }] } };
    });

    await expect(replayPending(fetchJSON, vi.fn())).resolves.toMatchObject({ replayed: 1, failed: 0 });
    expect(fetchJSON).toHaveBeenCalledTimes(1);
    expect(await listPending()).toEqual([]);
  });

  it("defers instead of risking a duplicate when remote identity cannot be verified", async () => {
    await enqueue("addMessage", "session-1", {
      role: "user",
      content: "unknown delivery",
      source_message_ids: ["pi67:unknown-source"],
    });
    const fetchJSON = vi.fn().mockResolvedValue({ ok: false, status: 0 });

    await expect(replayPending(fetchJSON, vi.fn())).resolves.toMatchObject({ replayed: 0, deferred: 1 });
    expect(fetchJSON).toHaveBeenCalledTimes(1);
    expect(await listPending()).toHaveLength(1);
  });

  it("creates a Session with server auto-commit disabled before replaying messages", async () => {
    await enqueue("addMessage", "session-1", { role: "user", content: "message" }, { createdAt: 1 });
    await enqueue("createSession", "session-1", {
      session_id: "session-1",
      auto_commit_policy: null,
    }, { createdAt: 2 });
    const calls: string[] = [];
    const fetchJSON = vi.fn(async (path: string, init?: { body?: string }) => {
      calls.push(path);
      if (path === "/api/v1/sessions/session-1") return { ok: false, status: 404 };
      if (path === "/api/v1/sessions") {
        expect(JSON.parse(String(init?.body))).toEqual({ session_id: "session-1", auto_commit_policy: null });
      }
      return { ok: true, result: {} };
    });

    await replayPending(fetchJSON, vi.fn());
    expect(calls).toEqual([
      "/api/v1/sessions/session-1",
      "/api/v1/sessions",
      "/api/v1/sessions/session-1/messages",
    ]);
  });

  it("acknowledges an already-created Session without posting it twice", async () => {
    const queued = await enqueue("createSession", "session-1", {
      session_id: "session-1",
      auto_commit_policy: null,
    });
    const fetchJSON = vi.fn().mockResolvedValue({ ok: true, result: { session_id: "session-1" } });

    const result = await replayPending(fetchJSON, vi.fn());
    expect(fetchJSON).toHaveBeenCalledWith("/api/v1/sessions/session-1");
    expect(fetchJSON).toHaveBeenCalledTimes(1);
    expect(result.outcomes[queued.dedupKey]).toBe("replayed");
    expect(await listPending()).toEqual([]);
  });
});
