import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import openVikingExtension from "./index.js";
import { OVClient } from "./client.js";
import { loadConfigFromModuleUrl } from "./config.js";
import { createScopedPendingQueue } from "./scoped-pending-queue.js";
import { enqueue } from "./shared/pending-queue.mjs";
import { createLocalMemoryEventBus } from "../pi-runtime/src/local-memory-extension-bridge.js";
import { bindPrivateMemoryCommitBus, requestPrivateMemoryCommit } from "../pi-runtime/src/private-memory-commit.js";

let root = "";
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture(mode: string, takeover = false, managed = false) {
  root = await mkdtemp(join(tmpdir(), "pi67-memory-privacy-"));
  const agent = join(root, "agent");
  const pending = join(root, "pending");
  await mkdir(agent);
  const setMode = async (privacyMode: string) => writeFile(join(agent, "openviking.json"), JSON.stringify({
    enabled: true, privacyMode, syncTurns: true, takeover: { enabled: takeover, overviewPollMs: 0, overviewPollMax: 1 }, logLevel: "silent"
  }));
  await setMode(mode);
  for (const [key, value] of Object.entries({
    PI_CODING_AGENT_DIR: agent, OPENVIKING_PENDING_DIR: pending,
    OPENVIKING_CREDENTIAL_SOURCE: "env", OPENVIKING_URL: "http://127.0.0.1:1933",
    OPENVIKING_API_KEY: "fixture-key", OPENVIKING_ACCOUNT: "fixture-account",
    OPENVIKING_USER: "fixture-user", OPENVIKING_PEER_ID: "fixture-peer"
  })) vi.stubEnv(key, value);
  const requests: Array<{ path: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    requests.push({ path: url.pathname, method });
    const missingSession = method === "GET" && /^\/api\/v1\/sessions\/[^/]+$/u.test(url.pathname);
    const result = url.pathname.endsWith("/ls") ? [] : url.pathname.endsWith("/commit")
      ? { status: "accepted", archived: true, task_id: "fixture-task" } : { status: "ok", session_id: "pi-fixture-session" };
    return new Response(JSON.stringify(missingSession ? { status: "error", error: { code: "NOT_FOUND" } } : { status: "ok", result }),
      { status: missingSession ? 404 : 200, headers: { "content-type": "application/json" } });
  }));
  const profileId = "e728ad55-4d62-4c2d-8587-f7bd2332309a";
  const connection = managed ? { localProfileId: profileId, endpoint: "http://127.0.0.1:1933",
    apiKey: "fixture-managed-key", account: `private-${profileId}`, user: "desktop" } : undefined;
  const queue = createScopedPendingQueue(new OVClient(loadConfigFromModuleUrl(import.meta.url), connection).memoryScopeKey);
  const handlers = new Map<string, (event: any, ctx: any) => Promise<any>>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>(); const entries: any[] = []; let branch: any[] = []; let history: any[] | undefined;
  const bus = createLocalMemoryEventBus();
  const services = {} as Parameters<typeof bindPrivateMemoryCommitBus>[0];
  bindPrivateMemoryCommitBus(services, bus);
  await openVikingExtension({
    events: bus,
    on: (name: string, handler: any) => {
      const previous = handlers.get(name);
      handlers.set(name, async (event, ctx) => { await previous?.(event, ctx); return handler(event, ctx); });
    },
    registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: (name: string, command: any) => commands.set(name, command), appendEntry: (...args: any[]) => entries.push(args)
  } as never, connection);
  const context = { sessionManager: { getSessionId: () => "fixture-session", getBranch: () => branch, getEntries: () => history ?? branch, getCwd: () => root },
    ui: { notify: vi.fn(), setStatus: vi.fn() } };
  const run = (name: string, event = {}) => handlers.get(name)?.({ prompt: "fixture prompt", systemPrompt: "system", messages: [], ...event }, context);
  const writes = () => requests.filter(({ path, method }) => path.startsWith("/api/v1/sessions") && method !== "GET");
  return { run, writes, requests, pending, queue, setMode, context, commands, entries, tools,
    commit: (sessionId = "fixture-session", canCommit = () => true) => requestPrivateMemoryCommit(services, sessionId, canCommit),
    setBranch: (value: any[]) => { branch = value; }, setHistory: (value: any[]) => { history = value; } };
}

describe("OpenViking lifecycle private write authority", () => {
  it.each([200, 503])("does not race automatic Commit against an in-flight Desktop Commit (%s)", async (status) => {
    const f = await fixture("private-learning");
    await f.run("session_start");
    const transport = globalThis.fetch, entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let commits = 0;
    vi.stubGlobal("fetch", async (input: any, init?: RequestInit) => {
      if (init?.method === "POST" && String(input).endsWith("/commit")) {
        commits++;
        if (commits === 1) {
          entered.resolve(); await release.promise;
          if (status !== 200) return new Response(JSON.stringify({ status: "error" }), { status });
        }
      }
      return transport(input, init);
    });
    const committing = f.commit();
    const settled = status === 200 ? expect(committing).resolves.toMatchObject({ archived: true }) : expect(committing).rejects.toThrow();
    await entered.promise;
    await f.run("session_before_compact");
    expect(commits).toBe(1);
    release.resolve();
    await settled;
    expect(await f.queue.listPending()).toEqual([]);
    await expect(f.commit()).resolves.toMatchObject({ archived: true });
    expect(commits).toBe(2);
  });
  it("commits managed memory without sending its local task identity to the legacy candidate tracker", async () => {
    const f = await fixture("private-learning", false, true);
    await f.run("session_start");
    await expect(f.commit()).resolves.toEqual({ status: "accepted", archived: true, extraction: "unconfirmed" });
    expect(f.writes().some(({ path }) => path.endsWith("/commit"))).toBe(true);
  });
  it("routes Desktop Commit through the owner and its actual OV lineage, returning only a receipt", async () => {
    const f = await fixture("private-learning");
    f.setBranch([{ type: "custom", customType: "ov-sync-state-v2", data: {
      version: 2, scopeKey: f.queue.scopeKey, piSessionId: "fixture-session",
      ovSessionId: "pi-fixture-session__lineage-3", lineage: 3, syncedCaptureCount: 0, prefixHash: ""
    } }]);
    await f.run("session_start");
    await expect(f.commit()).resolves.toEqual({ status: "accepted", archived: true, task_id: "fixture-task" });
    expect(f.writes().filter(({ path }) => path.endsWith("/commit"))).toEqual([
      { method: "POST", path: "/api/v1/sessions/pi-fixture-session__lineage-3/commit" }
    ]);
  });

  it.each(["read-only", "off", "wrong-session", "shared", "unowned"])("rejects Desktop Commit for %s without a write", async (reason) => {
    const f = await fixture("private-learning");
    if (reason === "unowned") f.setBranch([{ type: "message", message: { role: "user", content: "unknown" } }]);
    await f.run("session_start");
    const before = f.writes();
    if (reason === "read-only" || reason === "off") await f.setMode(reason);
    if (reason === "shared") await f.run("tool_call", { toolName: "viking_sop_read" });
    await expect(f.commit(reason === "wrong-session" ? "other-session" : "fixture-session")).rejects.toThrow();
    expect(f.writes()).toEqual(before);
  });

  it("rechecks Session admission after the async health boundary", async () => {
    const f = await fixture("private-learning");
    await f.run("session_start");
    let current = true;
    const before = f.writes();
    const committing = f.commit("fixture-session", () => current);
    current = false;
    await expect(committing).rejects.toThrow();
    expect(f.writes()).toEqual(before);
  });

  it("keeps reads available without creating, replaying or committing Sessions in read-only mode", async () => {
    const f = await fixture("read-only");
    await enqueue("commitSession", "older-session", {});
    const names = await readdir(f.pending);
    const before = await Promise.all(names.map((name) => readFile(join(f.pending, name), "utf8")));
    await f.run("session_start");
    await f.run("session_before_compact");
    await f.commands.get("viking").handler("commit", f.context);
    await f.run("session_shutdown");
    expect(f.writes()).toEqual([]);
    expect(f.requests.some(({ method, path }) => method === "GET" && path !== "/health")).toBe(true);
    expect(f.context.ui.notify).toHaveBeenCalledWith(expect.stringContaining("read-only"), "warning");
    expect(await readdir(f.pending)).toEqual(names);
    expect(await Promise.all(names.map((name) => readFile(join(f.pending, name), "utf8")))).toEqual(before);
  });

  it("preserves learning writes then stops them at the next boundary after tightening privacy", async () => {
    const f = await fixture("private-learning");
    await f.run("session_start");
    expect(f.writes().some(({ path }) => path === "/api/v1/sessions")).toBe(true);
    await f.run("session_before_compact");
    expect(f.writes().some(({ path }) => path.endsWith("/commit"))).toBe(true);
    const before = f.writes();
    await f.setMode("read-only");
    await f.run("session_before_compact");
    await f.commands.get("viking").handler("commit", f.context);
    await f.run("session_shutdown");
    expect(f.writes()).toEqual(before);
  });
});

describe("restored lifecycle boundaries", () => {
  it("restores a committed lineage for reads but never realigns, captures, replays or appends in read-only", async () => {
    const f = await fixture("read-only", true);
    f.setBranch([{type:"custom",customType:"ov-sync-state-v2",data:{version:2,scopeKey:f.queue.scopeKey,piSessionId:"fixture-session",ovSessionId:"pi-fixture-session__lineage-3",lineage:3,syncedCaptureCount:2,prefixHash:"a".repeat(64)}}]);
    await enqueue("commitSession", "older-session", {});
    const names=await readdir(f.pending);const before=await Promise.all(names.map(n=>readFile(join(f.pending,n),"utf8")));
    await f.run("session_start"); await f.run("before_agent_start"); await f.run("turn_end");
    await f.run("session_before_compact"); await f.run("agent_end"); await f.run("session_shutdown");
    expect(f.writes()).toEqual([]);expect(f.entries).toEqual([]);
    expect(f.requests.some(r=>r.path.includes("pi-fixture-session__lineage-3") && r.method==="GET")).toBe(true);
    expect(await readdir(f.pending)).toEqual(names);expect(await Promise.all(names.map(n=>readFile(join(f.pending,n),"utf8")))).toEqual(before);
  });
  it("default takeover learning can commit, and next-boundary tightening cannot be reopened in the loaded Session", async () => {
    const f=await fixture("private-learning",true); await f.run("session_start");
    await f.commands.get("viking").handler("commit",f.context);
    expect(f.writes().some(r=>r.path.endsWith("/commit"))).toBe(true);
    await f.setMode("read-only"); await f.run("before_agent_start");const before=f.writes(); const entryCount=f.entries.length;
    await f.setMode("private-learning");await f.run("turn_end");await f.run("session_before_compact");await f.commands.get("viking").handler("commit",f.context);await f.run("session_shutdown");
    const result=await f.tools.get("viking_remember").execute("fixture-call",{content:"fixture memory"},new AbortController().signal,()=>{},f.context);
    expect(result.content[0].text).toContain("read-only");expect(f.writes()).toEqual(before);expect(f.entries).toHaveLength(entryCount);
  });
});

describe("parallel Tool privacy revocation", () => {
  it("defers an earlier remember replay after a later read-only Tool boundary without consuming retries", async () => {
    const f=await fixture("private-learning",false); await f.run("session_start");
    const transport=globalThis.fetch;let release!:()=>void;let entered!:()=>void;
    const paused=new Promise<void>(r=>{entered=r;}); const gate=new Promise<void>(r=>{release=r;});let armed=true;
    vi.stubGlobal("fetch",async (input:any,init?:RequestInit)=>{
      if(armed && String(input).includes("/context?token_budget=128000")){armed=false;entered();await gate;}
      return transport(input,init);
    });
    const write=f.tools.get("viking_remember").execute("outstanding-call",{content:"fixture outstanding memory"},new AbortController().signal,()=>{},f.context);
    await paused;await f.setMode("read-only");
    await f.tools.get("viking_browse").execute("later-read-boundary",{action:"list"},new AbortController().signal,()=>{},f.context);
    const before=f.writes().length;release();await write;
    const afterBoundary=f.writes().slice(before);
    expect(afterBoundary).toEqual([]);
    const pending = await f.queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.entry.retries).toBe(0);
    expect(pending[0]!.entry.payload.content).toContain("fixture outstanding memory");
  });
});

describe("revocation while an authorized write is in flight", () => {
  it.each([503, 400, 200])("settles status %s without retrying or discarding a failed queued write after revocation", async (status) => {
    const f = await fixture("private-learning");
    await f.run("session_start");
    const transport = globalThis.fetch;
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (input: any, init?: RequestInit) => {
      if (init?.method === "POST" && String(input).endsWith("/messages")) {
        entered();
        await gate;
        return new Response(JSON.stringify(status === 200
          ? { status: "ok", result: {} }
          : { status: "error", error: { code: "fixture-failure" } }), { status });
      }
      return transport(input, init);
    });
    const writing = f.tools.get("viking_remember").execute("in-flight-write", { content: "fixture memory" },
      new AbortController().signal, () => {}, f.context);
    await paused;
    await f.setMode("read-only");
    await f.tools.get("viking_browse").execute("read-boundary", { action: "list" },
      new AbortController().signal, () => {}, f.context);
    release();
    await writing;
    const pending = await f.queue.listPending();
    if (status === 200) expect(pending).toEqual([]);
    else {
      expect(pending).toHaveLength(1);
      expect(pending[0]!.entry.retries).toBe(0);
    }
  });
});

describe("Session ownership through real Extension lifecycle", () => {
  it.each(["viking_shared_search", "viking_shared_read", "viking_sop_search", "viking_sop_read"])(
    "stops private capture before %s executes and never reopens it within the loaded Session", async (toolName) => {
      const f = await fixture("private-learning", true);
      await f.run("session_start");
      const before = f.writes(), entryCount = f.entries.length;
      await f.run("tool_call", { toolName, input: {} });
      f.setBranch([{ type: "message", message: { role: "assistant", content: "summary derived from shared knowledge" } }]);
      await f.run("turn_end");
      await f.run("session_before_compact");
      await f.commands.get("viking").handler("commit", f.context);
      const result = await f.tools.get("viking_remember").execute("shared-derived", { content: "derived memory" },
        new AbortController().signal, () => {}, f.context);
      expect(result.details).toMatchObject({ stored: false, reason: "memory-scope-unverified" });
      f.setBranch([]);
      await f.run("before_agent_start");
      await f.run("session_shutdown");
      expect(f.writes()).toEqual(before);
      expect(f.entries).toHaveLength(entryCount);
    }
  );

  it.each(["toolCall", "toolResult"])("blocks anchored history with a %s outside the active branch", async (kind) => {
    const f = await fixture("private-learning", true);
    const anchor = { type: "custom", customType: "ov-sync-state-v2", data: {
      version: 2, scopeKey: f.queue.scopeKey, piSessionId: "fixture-session",
      ovSessionId: "pi-fixture-session", lineage: 0, syncedCaptureCount: 0, prefixHash: ""
    } };
    const shared = kind === "toolCall"
      ? { role: "assistant", content: [{ type: "toolCall", id: "shared-call", name: "viking_shared_search", arguments: {} }] }
      : { role: "toolResult", toolCallId: "shared-call", toolName: "viking_sop_read", content: [{ type: "text", text: "shared SOP" }] };
    f.setBranch([anchor, { type: "compaction", summary: "derived summary", firstKeptEntryId: "kept", tokensBefore: 100 }]);
    f.setHistory([anchor, { type: "message", message: shared }]);
    await f.queue.enqueue("commitSession", "pi-fixture-session", {});
    const before = await f.queue.listPending();
    await f.run("session_start");
    await f.run("turn_end");
    await f.commands.get("viking").handler("commit", f.context);
    await f.run("session_shutdown");
    expect(f.writes()).toEqual([]);
    expect(f.entries).toEqual([]);
    expect(await f.queue.listPending()).toEqual(before);
  });

  it.each([
    null,
    { version: 1, kind: "shared-unverified", originSessionId: "fixture-session" },
    { version: 1, kind: "private", originSessionId: "other-session" },
    { version: 2, kind: "private", originSessionId: "fixture-session" },
  ])("honors persisted Desktop provenance outside the active branch %#", async (data) => {
    const f = await fixture("private-learning", true);
    const anchor = { type: "custom", customType: "ov-sync-state-v2", data: {
      version: 2, scopeKey: f.queue.scopeKey, piSessionId: "fixture-session",
      ovSessionId: "pi-fixture-session", lineage: 0, syncedCaptureCount: 0, prefixHash: ""
    } };
    f.setBranch([anchor]);
    f.setHistory([anchor, { type: "custom", customType: "pi67.memory-provenance.v1", data }]);
    await f.queue.enqueue("commitSession", "pi-fixture-session", {});
    const pending = await f.queue.listPending();
    await f.run("session_start");
    await f.run("before_agent_start");
    await f.run("turn_end");
    await f.commands.get("viking").handler("commit", f.context);
    const result = await f.tools.get("viking_remember").execute("blocked", { content: "must-not-capture" },
      new AbortController().signal, () => {}, f.context);
    await f.run("session_shutdown");
    expect(result.details).toMatchObject({ stored: false, reason: "memory-scope-unverified" });
    expect(f.writes()).toEqual([]);
    expect(f.entries).toEqual([]);
    expect(await f.queue.listPending()).toEqual(pending);
  });

  it("keeps a valid same-Session private marker writable until a restrictive marker is added", async () => {
    const f = await fixture("private-learning");
    const marker = { type: "custom", customType: "pi67.memory-provenance.v1",
      data: { version: 1, kind: "private", originSessionId: "fixture-session" } };
    f.setBranch([marker]);
    await f.run("session_start");
    expect(f.writes().length).toBeGreaterThan(0);
    const before = f.writes();
    f.setBranch([marker, { ...marker, data: { ...marker.data, kind: "shared-unverified" } },
      { type: "message", message: { role: "user", content: "derived context" } }]);
    await f.run("turn_end");
    await f.commands.get("viking").handler("commit", f.context);
    await f.run("session_shutdown");
    expect(f.writes()).toEqual(before);
  });

  it("defers an outstanding private write when a shared Tool starts before replay", async () => {
    const f = await fixture("private-learning");
    await f.run("session_start");
    const transport = globalThis.fetch;
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let armed = true;
    vi.stubGlobal("fetch", async (input: any, init?: RequestInit) => {
      if (armed && String(input).includes("/context?token_budget=128000")) {
        armed = false; entered.resolve(); await release.promise;
      }
      return transport(input, init);
    });
    const writing = f.tools.get("viking_remember").execute("pending-private", { content: "pending memory" },
      new AbortController().signal, () => {}, f.context);
    await entered.promise;
    await f.run("tool_call", { toolName: "viking_sop_search", input: {} });
    const before = f.writes();
    release.resolve();
    await writing;
    expect(f.writes()).toEqual(before);
    const pending = await f.queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.entry.retries).toBe(0);
  });

  it.each([
    { type: "message", id: "old-message", message: { role: "user", content: "old history" } },
    { type: "compaction", summary: "unknown compressed team content", firstKeptEntryId: "old-message", tokensBefore: 100 },
    { type: "branch_summary", summary: "unknown forked team content", fromId: "old-branch" },
    { type: "custom_message", customType: "fixture-context", content: "unknown extension context", display: true },
  ])("keeps unknown $type history blocked in capture, manual remember and automatic context", async (entry) => {
    const f = await fixture("private-learning", true);
    f.setBranch([entry]);
    await f.run("session_start");
    await f.run("before_agent_start");
    await f.run("turn_end");
    await f.run("session_before_compact");
    await f.commands.get("viking").handler("commit", f.context);
    await f.run("session_shutdown");
    const context = await f.run("context");
    const result = await f.tools.get("viking_remember").execute("blocked-remember", { content: "must-not-capture" },
      new AbortController().signal, () => {}, f.context);
    expect(result.details).toMatchObject({ stored: false, reason: "memory-scope-unverified" });
    expect(context.messages).toEqual([]);
    expect(f.writes()).toEqual([]);
    expect(f.entries).toEqual([]);
  });

  it("anchors ownership before an initial health failure and later recovers capture with real history", async () => {
    const f = await fixture("private-learning");
    const transport = globalThis.fetch;
    let failHealth = true;
    vi.stubGlobal("fetch", async (input: any, init?: RequestInit) => {
      if (String(input).endsWith("/health") && failHealth) { failHealth = false; throw new Error("fixture outage"); }
      return transport(input, init);
    });
    await f.run("session_start");
    expect(f.entries[0]).toMatchObject(["ov-sync-state-v2", { scopeKey: f.queue.scopeKey, syncedCaptureCount: 0 }]);
    expect(f.writes()).toEqual([]);
    f.setBranch([
      ...f.entries.map(([customType, data]) => ({ type: "custom", customType, data })),
      { type: "message", id: "new-message", message: { role: "user", content: "new history after outage" } },
    ]);
    await f.run("before_agent_start");
    await f.run("turn_end");
    expect(f.writes().some(({ path }) => path.endsWith("/messages"))).toBe(true);
  });
});
