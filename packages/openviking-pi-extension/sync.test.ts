import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OVClient } from "./client.js";
import type { OVConfig } from "./config.js";
import { SYNC_STATE_ENTRY_TYPE, SyncManager } from "./sync.js";

describe("OpenViking SyncManager lineage and identity", () => {
  let root = "";
  let previous: string | undefined;

  beforeEach(async () => {
    previous = process.env.OPENVIKING_PENDING_DIR;
    root = await mkdtemp(join(tmpdir(), "pi67-sync-outbox-"));
    process.env.OPENVIKING_PENDING_DIR = root;
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.OPENVIKING_PENDING_DIR;
    else process.env.OPENVIKING_PENDING_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the raw Pi Session identity separate from the derived OpenViking Session ID", async () => {
    const transport = fakeTransport();
    const sync = new SyncManager(transport.client, config());
    sync.restore([], "pi-jsonl-session-1");

    await expect(sync.ensureSession("pi-jsonl-session-1")).resolves.toBe(true);
    expect(sync.piSessionId).toBe("pi-jsonl-session-1");
    expect(sync.sessionId).toMatch(/^pi-/u);
    expect(sync.sessionId).not.toBe(sync.piSessionId);
    expect(transport.createBodies[0]).toMatchObject({ auto_commit_policy: null });
  });

  it("restores a semantic watermark and captures only a stable append", async () => {
    const transport = fakeTransport();
    const states: any[] = [];
    const branch = [message("u1", "user", "task"), custom("noise"), message("a1", "assistant", "answer")];
    const first = manager(transport.client, states);
    first.restore(branch, "pi-session");
    await first.ensureSession("pi-session");
    await expect(first.syncBranch(branch)).resolves.toMatchObject({ added: 2, lineageChanged: false });
    expect(first.syncedCount).toBe(2);
    expect(transport.messages.get(first.sessionId!)?.length).toBe(2);

    const resumed = manager(transport.client, states);
    resumed.restore([...branch, stateEntry(states.at(-1))], "pi-session");
    await resumed.ensureSession("pi-session");
    await expect(resumed.syncBranch([...branch, custom("more noise")])).resolves.toMatchObject({
      added: 0,
      lineageChanged: false,
    });

    const appended = [...branch, message("u2", "user", "next task")];
    await expect(resumed.syncBranch(appended)).resolves.toMatchObject({ added: 1, lineageChanged: false });
    expect(transport.messages.get(resumed.sessionId!)?.length).toBe(3);
  });

  it("moves same-length branch replacement and rewind into a new OV lineage", async () => {
    const transport = fakeTransport();
    const states: any[] = [];
    const original = [message("u1", "user", "task"), message("a1", "assistant", "old answer")];
    const first = manager(transport.client, states);
    first.restore(original, "pi-session");
    await first.ensureSession("pi-session");
    await first.syncBranch(original);
    const baseSessionId = first.sessionId!;

    const replaced = [message("u1", "user", "task"), message("a2", "assistant", "new answer")];
    const replacement = manager(transport.client, states);
    replacement.restore([...replaced, stateEntry(states.at(-1))], "pi-session");
    await replacement.ensureSession("pi-session");
    await expect(replacement.syncBranch(replaced)).resolves.toMatchObject({ added: 2, lineageChanged: true });
    expect(replacement.sessionId).toBe(`${baseSessionId}__lineage-1`);
    expect(transport.messages.get(baseSessionId)?.map((value) => text(value))).toEqual(["task", "old answer"]);
    expect(transport.messages.get(replacement.sessionId!)?.map((value) => text(value))).toEqual(["task", "new answer"]);

    const rewindStates: any[] = [];
    const rewind = manager(transport.client, rewindStates);
    rewind.restore([message("u1", "user", "task"), stateEntry(states.at(-1))], "pi-session");
    await rewind.ensureSession("pi-session");
    await expect(rewind.syncBranch([message("u1", "user", "task")])).resolves.toMatchObject({
      added: 1,
      lineageChanged: true,
    });
  });
});

function manager(client: OVClient, states: any[]): SyncManager {
  return new SyncManager(client, config(), {
    persistEntry: (customType, data) => states.push({ customType, data }),
  });
}

function fakeTransport() {
  const messages = new Map<string, any[]>();
  const createBodies: any[] = [];
  const fetchJSON = vi.fn(async (path: string, init?: { body?: string }) => {
    const sessionMatch = path.match(/^\/api\/v1\/sessions\/([^/?]+)$/u);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]!);
      return messages.has(sessionId)
        ? { ok: true, result: { session_id: sessionId } }
        : { ok: false, status: 404, result: null };
    }
    if (path === "/api/v1/sessions") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      createBodies.push(body);
      messages.set(body.session_id, messages.get(body.session_id) ?? []);
      return { ok: true, result: { session_id: body.session_id } };
    }
    const match = path.match(/^\/api\/v1\/sessions\/([^/]+)\/(context|messages)/u);
    if (!match) return { ok: true, result: {} };
    const sessionId = decodeURIComponent(match[1]!);
    if (match[2] === "context") {
      return { ok: true, result: { messages: messages.get(sessionId) ?? [] } };
    }
    const payload = JSON.parse(String(init?.body ?? "{}"));
    messages.set(sessionId, [...(messages.get(sessionId) ?? []), payload]);
    return { ok: true, result: { message_count: messages.get(sessionId)?.length ?? 0 } };
  });
  return {
    messages,
    createBodies,
    client: {
      connected: true,
      fetchJSON,
      getSession: vi.fn().mockResolvedValue({ pending_tokens: 0 }),
    } as unknown as OVClient,
  };
}

function config(): OVConfig {
  return {
    peerId: "workspace-peer",
    faithfulCapture: true,
    captureAssistantTurns: true,
    captureToolResults: false,
    captureMaxLength: 24_000,
    takeoverEnabled: true,
    commitTokenThreshold: 20_000,
  } as unknown as OVConfig;
}

function message(id: string, role: string, content: string) {
  return { type: "message", id, parentId: `${id}-parent`, message: { role, content } };
}

function custom(id: string) {
  return { type: "custom", customType: "fixture", data: { id } };
}

function stateEntry(value: any) {
  expect(value?.customType).toBe(SYNC_STATE_ENTRY_TYPE);
  return { type: "custom", customType: value.customType, data: value.data };
}

function text(payload: any): string {
  return typeof payload.content === "string"
    ? payload.content
    : payload.parts?.map((part: any) => part.text ?? "").join("") ?? "";
}
