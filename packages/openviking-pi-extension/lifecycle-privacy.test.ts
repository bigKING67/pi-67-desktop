import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import openVikingExtension from "./index.js";
import { enqueue, listPending } from "./shared/pending-queue.mjs";

let root = "";
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture(mode: string, takeover = false) {
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
    const result = url.pathname.endsWith("/ls") ? [] : { status: "ok", session_id: "pi-fixture-session" };
    return new Response(JSON.stringify(missingSession ? { status: "error", error: { code: "NOT_FOUND" } } : { status: "ok", result }),
      { status: missingSession ? 404 : 200, headers: { "content-type": "application/json" } });
  }));
  const handlers = new Map<string, (event: any, ctx: any) => Promise<any>>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>(); const entries: any[] = []; let branch: any[] = [];
  await openVikingExtension({
    on: (name: string, handler: any) => handlers.set(name, handler),
    registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: (name: string, command: any) => commands.set(name, command), appendEntry: (...args: any[]) => entries.push(args)
  } as never);
  const context = { sessionManager: { getSessionId: () => "fixture-session", getBranch: () => branch, getCwd: () => root },
    ui: { notify: vi.fn(), setStatus: vi.fn() } };
  const run = (name: string) => handlers.get(name)?.({ prompt: "fixture prompt", systemPrompt: "system", messages: [] }, context);
  const writes = () => requests.filter(({ path, method }) => path.startsWith("/api/v1/sessions") && method !== "GET");
  return { run, writes, requests, pending, setMode, context, commands, entries, tools, setBranch: (value: any[]) => { branch = value; } };
}

describe("OpenViking lifecycle private write authority", () => {
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
    f.setBranch([{type:"custom",customType:"ov-sync-state-v1",data:{version:1,piSessionId:"fixture-session",ovSessionId:"pi-fixture-session__lineage-3",lineage:3,syncedCaptureCount:2,prefixHash:"a".repeat(64)}}]);
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
    const pending = await listPending();
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
    const pending = await listPending();
    if (status === 200) expect(pending).toEqual([]);
    else {
      expect(pending).toHaveLength(1);
      expect(pending[0]!.entry.retries).toBe(0);
    }
  });
});
