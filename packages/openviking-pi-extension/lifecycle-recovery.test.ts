import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import openVikingExtension from "./index.js";

const previousEnvironment = new Map<string, string | undefined>();

describe("OpenViking Pi lifecycle recovery", () => {
  let root = "";

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const [key, value] of previousEnvironment) restoreEnvironment(key, value);
    previousEnvironment.clear();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("recovers Recall and Capture after startup health failure without restarting Pi", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-openviking-lifecycle-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({
      enabled: true,
      privacyMode: "private-learning",
      syncTurns: true,
      takeover: { enabled: false },
      captureAssistantTurns: true,
      captureToolResults: false,
      logLevel: "silent",
    }));
    setEnvironment({
      PI_CODING_AGENT_DIR: agentDir,
      OPENVIKING_PENDING_DIR: join(root, "pending"),
      OPENVIKING_CREDENTIAL_SOURCE: "env",
      OPENVIKING_URL: "http://127.0.0.1:1933",
      OPENVIKING_API_KEY: "fixture-user-key",
      OPENVIKING_ACCOUNT: "fixture-account",
      OPENVIKING_USER: "fixture-user",
      OPENVIKING_PEER_ID: "fixture-peer",
    });

    let healthAttempts = 0;
    let remoteSessionCreated = false;
    const remoteMessages: Record<string, unknown>[] = [];
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      const method = init?.method ?? "GET";
      requests.push({ path: `${url.pathname}${url.search}`, method });
      if (url.pathname === "/health" && healthAttempts++ === 0) {
        throw new Error("synthetic startup outage");
      }
      if (url.pathname === "/api/v1/sessions" && method === "POST") {
        remoteSessionCreated = true;
        return ok({ created: true });
      }
      if (url.pathname.endsWith("/messages") && method === "POST") {
        const body = typeof init?.body === "string" ? init.body : "{}";
        remoteMessages.push(JSON.parse(body) as Record<string, unknown>);
        return ok({ accepted: true });
      }
      if (url.pathname.endsWith("/context")) {
        return ok({
          latest_archive_overview: null,
          pre_archive_abstracts: [],
          messages: remoteMessages,
          estimatedTokens: 0,
          stats: {},
        });
      }
      if (/^\/api\/v1\/sessions\/[^/]+$/u.test(url.pathname) && !remoteSessionCreated) {
        return notFound();
      }
      if (url.pathname.startsWith("/api/v1/sessions/")) {
        return ok({ session_id: "fixture-session", message_count: remoteMessages.length, pending_tokens: 0 });
      }
      if (url.pathname === "/api/v1/search/search") {
        return ok({
          rendered: "recovered memory context",
          entries: [{
            uri: "viking://user/fixture-user/peers/fixture-peer/memories/events/recovery.md",
            category: "events",
            detail: "abstract",
            score: 0.9,
            text: "recovered memory context",
          }],
          digest: "",
          stats: { used_tokens: 5 },
        });
      }
      if (url.pathname === "/api/v1/system/status") return ok({ user: "fixture-user" });
      if (url.pathname === "/api/v1/fs/ls") return ok([]);
      if (url.pathname === "/api/v1/content/read") return notFound();
      return ok({ status: "ok" });
    }));

    const handlers = new Map<string, (event: any, context: any) => Promise<any>>();
    const registeredTools: string[] = [];
    const persistedEntries: Array<{ customType: string; data: unknown }> = [];
    const pi = {
      on: (name: string, handler: (event: any, context: any) => Promise<any>) => handlers.set(name, handler),
      registerTool: (tool: { name: string }) => registeredTools.push(tool.name),
      registerCommand: vi.fn(),
      appendEntry: (customType: string, data: unknown) => persistedEntries.push({ customType, data }),
    };
    await openVikingExtension(pi as never);

    let branch: unknown[] = [];
    const context = {
      sessionManager: {
        getSessionId: () => "pi-session-recovery",
        getBranch: () => branch,
      },
      ui: { notify: vi.fn(), setStatus: vi.fn() },
    };
    await handlers.get("session_start")?.({}, context);
    expect(healthAttempts).toBe(1);
    expect(requests.some(({ path }) => path.startsWith("/api/v1/sessions"))).toBe(false);
    expect(registeredTools).toContain("viking_search");

    const before = await handlers.get("before_agent_start")?.({
      prompt: "请继续恢复任务",
      systemPrompt: "base system",
    }, context);
    expect(before?.systemPrompt).toContain("OpenViking tools");
    const projected = await handlers.get("context")?.({
      messages: [{ role: "user", content: "请继续恢复任务" }],
    }, context);
    expect(projected?.messages[0].content).toContain("recovered memory context");

    branch = [
      { type: "message", id: "u1", message: { role: "user", content: "请继续恢复任务" } },
      { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: "任务已恢复" } },
    ];
    await handlers.get("turn_end")?.({}, context);

    expect(healthAttempts).toBe(2);
    expect(requests.some(({ path }) => path === "/api/v1/search/search")).toBe(true);
    expect(requests.filter(({ path, method }) => path.endsWith("/messages") && method === "POST")).toHaveLength(2);
    expect(remoteMessages).toHaveLength(2);
    expect(persistedEntries.some(({ customType }) => customType === "ov-sync-state-v1")).toBe(true);
  });

  it("keeps Session creation degradation in diagnostics instead of an error toast", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-openviking-create-degraded-"));
    const agentDir = join(root, "agent");
    const diagnosticsPath = join(root, "context-events.ndjson");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({
      enabled: true,
      privacyMode: "private-learning",
      takeover: { enabled: false },
      logLevel: "error",
    }));
    setEnvironment({
      PI_CODING_AGENT_DIR: agentDir,
      PI67_CONTEXT_EVENT_LOG: diagnosticsPath,
      OPENVIKING_PENDING_DIR: join(root, "pending"),
      OPENVIKING_CREDENTIAL_SOURCE: "env",
      OPENVIKING_URL: "http://127.0.0.1:1933",
      OPENVIKING_API_KEY: "fixture-user-key",
      OPENVIKING_ACCOUNT: "fixture-account",
      OPENVIKING_USER: "fixture-user",
      OPENVIKING_PEER_ID: "fixture-peer",
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname === "/health") return ok({ version: "fixture" });
      if (/^\/api\/v1\/sessions\/[^/]+$/u.test(url.pathname)) return notFound();
      if (url.pathname === "/api/v1/sessions" && init?.method === "POST") {
        return new Response(JSON.stringify({ status: "error" }), { status: 503 });
      }
      return ok({});
    }));
    const handlers = new Map<string, (event: any, context: any) => Promise<any>>();
    const pi = {
      on: (name: string, handler: (event: any, context: any) => Promise<any>) => handlers.set(name, handler),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
    };
    await openVikingExtension(pi as never);
    const notify = vi.fn();
    await handlers.get("session_start")?.({}, {
      sessionManager: { getSessionId: () => "pi-session-degraded", getBranch: () => [] },
      ui: { notify, setStatus: vi.fn() },
    });

    expect(notify).not.toHaveBeenCalled();
    const diagnostics = (await readFile(diagnosticsPath, "utf8"))
      .trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    expect(diagnostics).toContainEqual(expect.objectContaining({
      kind: "context.healthChanged",
      state: "degraded",
      reason: "session-create-failed",
    }));
  });
});

function ok(result: unknown): Response {
  return new Response(JSON.stringify({ status: "ok", result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function notFound(): Response {
  return new Response(JSON.stringify({ status: "error", error: { message: "not found" } }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

function setEnvironment(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    previousEnvironmentValue(key);
    process.env[key] = value;
  }
}

function previousEnvironmentValue(key: string): void {
  if (!process.env[key] && process.env[key] !== "") previousEnvironment.set(key, undefined);
  else previousEnvironment.set(key, process.env[key]);
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
