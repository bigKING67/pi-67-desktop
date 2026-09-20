import { copyFile, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVClient } from "./client.js";
import type { OVConfig } from "./config.js";
import type { ManagedMemoryConnection } from "./managed-connection.js";
import { createScopedPendingQueue } from "./scoped-pending-queue.js";
import { SyncManager, SYNC_STATE_ENTRY_TYPE } from "./sync.js";
import { enqueue, listPending } from "./shared/pending-queue.mjs";

let root = "";
let requests: Array<{ url: string; method: string; peer: string | null; redirect: RequestRedirect | undefined; body: any }> = [];
let transport: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const sid = "fixture-pi-session";
const message = (id = "user-1") => ({ type: "message", id, message: { role: "user", content: "fixture history" } });
const cfg = (overrides: Partial<OVConfig> = {}): OVConfig => ({
  enabled: true, privateWriteEnabled: true, endpoint: "http://scope-a.invalid", apiKey: "fixture-key-a",
  account: "account-a", user: "user-a", peerId: "peer-a", healthTimeoutMs: 500,
  faithfulCapture: true, captureAssistantTurns: true, captureToolResults: false,
  captureMaxLength: 24000, takeoverEnabled: true, commitTokenThreshold: 20000, commitKeepRecentCount: 0,
  ...overrides,
} as OVConfig);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pi67-scoped-outbox-"));
  vi.stubEnv("OPENVIKING_PENDING_DIR", root);
  requests = [];
  transport = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    requests.push({ url: url.toString(), method, peer: new Headers(init?.headers).get("X-OpenViking-Actor-Peer"), redirect: init?.redirect,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const missing = method === "GET" && /^\/api\/v1\/sessions\/[^/]+$/u.test(url.pathname);
    return new Response(JSON.stringify(missing ? { status: "error" } : { status: "ok", result: { messages: [] } }),
      { status: missing ? 404 : 200 });
  };
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => transport(input, init));
});
afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});
async function manager(overrides: Partial<OVConfig> = {}, persist?: (type: string, data: any) => void, managed?: ManagedMemoryConnection) {
  const config = cfg(overrides);
  const client = new OVClient(config, managed);
  await client.ensureConnected();
  const states: any[] = [];
  const sync = new SyncManager(client, config, { persistEntry: persist ?? ((customType, data) => states.push({ type: "custom", customType, data })) });
  const queue = createScopedPendingQueue(client.memoryScopeKey);
  return { client, config, sync, queue, states };
}
async function start(m: Awaited<ReturnType<typeof manager>>) {
  m.sync.restore([], sid);
  await expect(m.sync.ensureSession(sid)).resolves.toBe(true);
}

describe("Endpoint and actor owned outbox", () => {
  it.each(["createSession", "addMessage", "commitSession"])("preserves another Session's expired %s and abandoned claim", async (type) => {
    const a = await manager();
    await a.queue.enqueue(type, "pi-other", { session_id: "pi-other", role: "user", content: "foreign-session" });
    const pending = (await a.queue.listPending())[0]!;
    const directory = join(root, "scoped-v1", a.queue.scopeKey);
    const path = join(directory, pending.filename);
    const original = JSON.stringify({ ...pending.entry, createdAt: 0, retries: 99 });
    await writeFile(path, original);
    const processing = path.replace(/\.json$/u, ".processing");
    await copyFile(path, processing);
    await utimes(processing, 0, 0);
    await start(a);
    await expect(a.sync.flushForTakeover()).resolves.toBe(true);
    expect(requests.some(r => r.url.includes("pi-other") || r.body?.session_id === "pi-other")).toBe(false);
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readFile(processing, "utf8")).toBe(original);
  });

  it("waits for the exact anchored Session instead of adopting its outbox in a new Session", async () => {
    const original = await manager();
    await start(original);
    await original.queue.enqueue("addMessage", original.sync.sessionId!, { role: "user", content: "old-private" });
    const pending = await original.queue.listPending();
    const next = await manager();
    next.sync.restore([], "new-session");
    await expect(next.sync.ensureSession("new-session")).resolves.toBe(true);
    expect(requests.some(r => r.body?.content === "old-private")).toBe(false);
    expect(await original.queue.listPending()).toEqual(pending);
    const resumed = await manager();
    resumed.sync.restore(original.states, sid);
    await expect(resumed.sync.ensureSession(sid)).resolves.toBe(true);
    expect(requests.filter(r => r.body?.content === "old-private")).toHaveLength(1);
    expect(await original.queue.listPending()).toEqual([]);
  });

  it("preserves a malformed create payload rather than creating a different remote Session", async () => {
    const a = await manager();
    await start(a);
    await a.queue.enqueue("createSession", a.sync.sessionId!, { session_id: "pi-other" });
    const pending = await a.queue.listPending();
    const before = requests.length;
    await a.sync.replayPending();
    expect(requests).toHaveLength(before);
    expect(await a.queue.listPending()).toEqual(pending);
  });
  const profile = "e728ad55-4d62-4c2d-8587-f7bd2332309a";
  const managed: ManagedMemoryConnection = { endpoint: "http://127.0.0.1:32101", apiKey: "managed-synthetic-key",
    localProfileId: profile, account: `private-${profile}`, user: "desktop" };

  it("replays a managed private outbox across port/key rotation without adopting external queues", async () => {
    const first = await manager({}, undefined, managed);
    await start(first);
    await first.queue.enqueue("addMessage", first.sync.sessionId!, { role: "user", content: "managed-private-note" });
    const restarted = await manager({}, undefined, { ...managed, endpoint: "http://127.0.0.1:32102", apiKey: "rotated-key" });
    expect(restarted.client.memoryScopeKey).toBe(first.client.memoryScopeKey);
    const external = await manager({ endpoint: managed.endpoint, apiKey: managed.apiKey, account: managed.account, user: managed.user });
    expect(external.client.memoryScopeKey).not.toBe(first.client.memoryScopeKey);
    restarted.sync.restore(first.states, sid);
    await expect(restarted.sync.ensureSession(sid)).resolves.toBe(true);
    expect(requests.filter((request) => request.body?.content === "managed-private-note")).toMatchObject([
      { url: `http://127.0.0.1:32102/api/v1/sessions/pi-${sid}/messages`, peer: "peer-a", redirect: "error" },
    ]);
    expect(await first.queue.listPending()).toEqual([]);
  });

  it("keeps managed profile/user/workspace isolation and rejects invalid private connections", () => {
    const original = new OVClient(cfg(), managed).memoryScopeKey;
    const otherProfile = "790c15d9-f594-4fd6-abd2-866f87c4b7d9";
    expect(new OVClient(cfg(), { ...managed, localProfileId: otherProfile, account: `private-${otherProfile}` }).memoryScopeKey).not.toBe(original);
    expect(new OVClient(cfg(), { ...managed, user: "other-user" }).memoryScopeKey).not.toBe(original);
    expect(new OVClient(cfg({ peerId: "peer-b" }), managed).memoryScopeKey).not.toBe(original);
    for (const changed of [{ endpoint: "https://remote.test" }, { endpoint: "http://127.0.0.1:65536" },
      { account: "team-scope" }, { localProfileId: "invalid" }, { apiKey: "" }, { user: "bad\r\nheader" }]) {
      expect(() => new OVClient(cfg(), { ...managed, ...changed })).toThrow("Invalid managed private memory connection.");
    }
  });

  it.each([
    { endpoint: "http://scope-b.invalid" }, { account: "account-b" }, { user: "user-b" }, { peerId: "peer-b" },
  ])("does not let a new scope dispatch another queue: %j", async (other) => {
    const a = await manager();
    await start(a);
    await a.queue.enqueue("addMessage", a.sync.sessionId!, { role: "user", content: "scope-a-only" });
    const before = await a.queue.listPending();
    const b = await manager(other);
    await start(b);
    await b.sync.addPayload({ role: "user", content: "scope-b-only" });
    expect(requests.some((r) => r.body?.content === "scope-a-only")).toBe(false);
    expect(await a.queue.listPending()).toEqual(before);
    expect(await b.queue.listPending()).toEqual([]);
    await start(a);
    expect(requests.filter((r) => r.body?.content === "scope-a-only")).toMatchObject([
      { url: `http://scope-a.invalid/api/v1/sessions/pi-${sid}/messages`, peer: "peer-a" },
    ]);
  });

  it("uses credential partitioning only for incomplete actor headers without storing credentials", async () => {
    expect(new OVClient(cfg({ apiKey: "rotated-key" })).memoryScopeKey).toBe(new OVClient(cfg()).memoryScopeKey);
    for (const actor of [{ account: "" }, { user: "" }]) {
      const a = new OVClient(cfg(actor));
      const b = new OVClient(cfg({ ...actor, apiKey: "rotated-key" }));
      expect(a.memoryScopeKey).not.toBe(b.memoryScopeKey);
      const q = createScopedPendingQueue(a.memoryScopeKey);
      await q.enqueue("commitSession", sid, {});
      expect(JSON.stringify(await q.listPending())).not.toContain("fixture-key-a");
    }
  });

  it("preserves legacy and foreign JSON/processing entries through scoped recovery and cleanup", async () => {
    await enqueue("commitSession", "legacy", {});
    const legacy = await listPending();
    const a = await manager(); const b = await manager({ peerId: "peer-b" });
    await a.queue.enqueue("commitSession", "owned", {});
    await b.queue.enqueue("commitSession", "foreign", {});
    const foreign = (await b.queue.listPending())[0]!;
    const adir = join(root, "scoped-v1", a.queue.scopeKey);
    const bdir = join(root, "scoped-v1", b.queue.scopeKey);
    await copyFile(join(bdir, foreign.filename), join(adir, foreign.filename));
    const processing = foreign.filename.replace(/\.json$/u, ".processing");
    await copyFile(join(bdir, foreign.filename), join(adir, processing));
    await utimes(join(adir, processing), 0, 0);
    const foreignBefore = await readFile(join(adir, foreign.filename), "utf8");
    await a.queue.replayPending(async () => ({ ok: true }), vi.fn(), () => true, "owned");
    expect(await a.queue.listPending()).toEqual([]);
    expect(await listPending()).toEqual(legacy);
    expect(await readFile(join(adir, foreign.filename), "utf8")).toBe(foreignBefore);
    expect(await readFile(join(adir, processing), "utf8")).toBe(foreignBefore);
    expect(await b.queue.listPending()).toEqual([foreign]);
  });

  it("freezes the queue root instead of following later environment changes", async () => {
    const a = await manager();
    vi.stubEnv("OPENVIKING_PENDING_DIR", join(root, "other"));
    await a.queue.enqueue("commitSession", sid, {});
    expect(await a.queue.listPending()).toHaveLength(1);
    expect(await listPending()).toEqual([]);
  });
});

describe("scope-bound watermark and replay authority", () => {
  it.each(["compaction", "branch_summary", "custom_message"])("preserves a verified private anchor across %s history", async (type) => {
    const a = await manager(); await start(a);
    const b = await manager();
    b.sync.restore([...a.states, { type, summary: "owned history", content: "owned extension message" }], sid);
    expect(b.sync.blockedReason).toBeUndefined();
    await expect(b.sync.ensureSession(sid)).resolves.toBe(true);
    await expect(b.sync.addPayload({ role: "user", content: "new owned memory" })).resolves.toEqual({ accepted: true, delivered: true });
  });

  it("does not mistake Pi non-context metadata for unowned conversation history", async () => {
    const a = await manager();
    a.sync.restore([
      { type: "model_change", provider: "fixture", modelId: "fixture" },
      { type: "thinking_level_change", thinkingLevel: "off" },
      { type: "label", targetId: "entry", label: "fixture" },
      { type: "session_info", name: "fixture" },
      { type: "custom", customType: "fixture-extension-state", data: { enabled: true } },
    ], sid);
    expect(a.sync.blockedReason).toBeUndefined();
    await expect(a.sync.ensureSession(sid)).resolves.toBe(true);
  });

  it("anchors before first enqueue, restores the latest same-scope watermark and captures only new history", async () => {
    const a = await manager();
    a.sync.restore([], sid);
    expect(a.states).toEqual([]);
    await a.sync.ensureSession(sid);
    expect(a.states[0]).toMatchObject({ customType: SYNC_STATE_ENTRY_TYPE, data: { version: 2, scopeKey: a.queue.scopeKey, syncedCaptureCount: 0 } });
    await a.sync.syncBranch([message()]);
    const b = await manager();
    b.sync.restore([message(), ...a.states], sid);
    expect(b.sync.syncedCount).toBe(1);
    await b.sync.ensureSession(sid);
    await expect(b.sync.syncBranch([message(), message("user-2")])).resolves.toMatchObject({ added: 1, allDelivered: true });
  });

  it.each(["legacy", "foreign", "missing", "malformed"])("blocks %s history instead of resetting and recapturing it", async (kind) => {
    const a = await manager(); await start(a);
    const good = a.states[0];
    const bad = kind === "legacy" ? { ...good, customType: "ov-sync-state-v1", data: { ...good.data, version: 1, scopeKey: undefined } }
      : kind === "foreign" ? { ...good, data: { ...good.data, scopeKey: "f".repeat(64) } }
      : { ...good, data: { ...good.data, ovSessionId: 42 } };
    const b = await manager();
    b.sync.restore(kind === "missing" ? [message()] : [message(), good, bad], sid);
    const before = requests.length;
    await expect(b.sync.ensureSession(sid)).resolves.toBe(false);
    await expect(b.sync.syncBranch([message()])).resolves.toMatchObject({ allDelivered: false, blockedReason: "memory-scope-unverified" });
    await expect(b.sync.addPayload({ content: "must-not-store" })).resolves.toEqual({ accepted: false, delivered: false });
    await expect(b.sync.flushForTakeover()).resolves.toBe(false);
    await expect(b.sync.commit()).resolves.toBeNull();
    expect(requests).toHaveLength(before);
    expect(b.states).toEqual([]);
  });

  it("does not enqueue or send when the initial scope anchor cannot persist", async () => {
    const a = await manager({}, () => { throw new Error("fixture persistence failure"); });
    a.sync.restore([], sid);
    const before = requests.length;
    await expect(a.sync.ensureSession(sid)).resolves.toBe(false);
    expect(requests).toHaveLength(before);
    expect(await a.queue.listPending()).toEqual([]);
  });

  it("stops a pending replay and direct commit when the current client peer changes", async () => {
    const a = await manager(); await start(a);
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const paused = new Promise<void>((resolve) => { entered = resolve; });
    const original = transport;
    transport = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/context?token_budget=128000")) { entered(); await gate; }
      return original(input, init);
    };
    const writing = a.sync.addPayload({ role: "user", content: "old-peer-only", source_message_ids: ["source-1"] });
    await paused;
    a.client.setPeerId("peer-b");
    release(); await writing;
    const before = requests.length;
    await expect(a.sync.commit()).resolves.toBeNull();
    await a.sync.replayPending();
    expect(requests).toHaveLength(before);
    expect(requests.some((r) => r.body?.content === "old-peer-only")).toBe(false);
    expect((await a.queue.listPending())[0]!.entry.retries).toBe(0);
  });
});
