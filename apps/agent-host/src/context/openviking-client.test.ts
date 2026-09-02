import {
  DEFAULT_CONTEXT_MEMORY_CONFIGURATION,
  type ContextMemoryConfiguration
} from "@pi67/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenVikingClient } from "./openviking-client.js";

const NO_CREDENTIALS = { source: "none" as const };

const configuration: ContextMemoryConfiguration = {
  ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION,
  revision: "test-revision"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenVikingClient", () => {
  it("uses bounded health and Session contracts with an opaque actor peer", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.endsWith("/health")) return jsonResponse({ status: "ok", result: { version: "0.4.16" } });
      if (url.includes("/sessions/session%2Fone/commit")) {
        return jsonResponse({ status: "ok", result: {
          status: "accepted",
          archived: true,
          task_id: "task-1"
        } });
      }
      return jsonResponse({ status: "ok", result: {
        session_id: "session/one",
        message_count: 2,
        total_message_count: 7,
        pending_tokens: 900,
        last_commit_at: "2026-08-31T00:00:00Z"
      } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenVikingClient(configuration, "a".repeat(64), {
      source: "ovcli",
      bearerToken: "fixture-user-key"
    });

    await expect(client.health()).resolves.toMatchObject({ version: "0.4.16", latencyMs: expect.any(Number) });
    await expect(client.getSession("session/one")).resolves.toMatchObject({ total_message_count: 7 });
    await client.commitSession("session/one");

    const [, commitInit] = fetchMock.mock.calls[3] ?? [];
    expect(commitInit?.method).toBe("POST");
    expect(typeof commitInit?.body === "string" ? JSON.parse(commitInit.body) : undefined)
      .toEqual({ retention_mode: "turn_budget", keep_recent_turn_count: 3 });
    expect(new Headers(commitInit?.headers).get("X-OpenViking-Actor-Peer")).toBe("a".repeat(64));
    expect(new Headers(commitInit?.headers).get("Authorization")).toBe("Bearer fixture-user-key");
  });

  it("normalizes and bounds heterogeneous search buckets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "ok", result: {
      memories: [
        { uri: "viking://user/memories/one", context_type: "memory", score: 2, abstract: "One", overview: null },
        { uri: "viking://user/memories/two", score: -1, overview: "Two overview", category: "case", match_reason: "matched" },
        { uri: 7 },
        null
      ],
      resources: [{ uri: "viking://resources/team", score: "bad", abstract: 9 }],
      skills: [{ uri: "viking://skills/one", score: 0.8, abstract: "Skill" }],
      ignored: [{ uri: "viking://ignored" }]
    } })));
    const client = new OpenVikingClient(configuration, undefined, NO_CREDENTIALS);

    const items = await client.search("recovery", {
      limit: 3,
      scope: "workspace",
      targetUri: "viking://user/memories"
    });

    expect(items).toEqual([
      expect.objectContaining({ uri: "viking://user/memories/one", score: 1, overview: null }),
      expect.objectContaining({ uri: "viking://user/memories/two", score: 0, context_type: "memory", category: "case", match_reason: "matched" }),
      expect.objectContaining({ uri: "viking://resources/team", score: 0, context_type: "resource", abstract: "" })
    ]);
  });

  it("reads abstract and full-content variants and issues a non-recursive private delete", async () => {
    const replies: unknown[] = [
      { status: "ok", result: "plain" },
      { status: "ok", result: { abstract: "object" } },
      { status: "ok", result: 7 },
      { status: "ok", result: "full plain" },
      { status: "ok", result: { content: "full object" } },
      { status: "ok", result: {} }
    ];
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse(replies.shift()));
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenVikingClient(configuration, undefined, NO_CREDENTIALS);

    await expect(client.abstract("viking://user/memories/a")).resolves.toBe("plain");
    await expect(client.abstract("viking://user/memories/b")).resolves.toBe("object");
    await expect(client.abstract("viking://user/memories/c")).resolves.toBe("");
    await expect(client.read("viking://user/memories/a")).resolves.toBe("full plain");
    await expect(client.read("viking://user/memories/b")).resolves.toBe("full object");
    await client.forget("viking://user/memories/a");

    const deleteInput = fetchMock.mock.calls[5]?.[0];
    expect(deleteInput === undefined ? "" : requestUrl(deleteInput)).toContain("recursive=false");
    expect(fetchMock.mock.calls[5]?.[1]?.method).toBe("DELETE");
  });

  it("reads bounded task and directory-listing receipts", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.includes("/tasks/task-1")) return jsonResponse({ status: "ok", result: {
        task_id: "task-1",
        task_type: "session_commit",
        status: "completed",
        result: {
          session_id: "session-1",
          archive_uri: "viking://user/local/sessions/session-1/history/archive_001",
          memory_diff_uri: "viking://user/local/sessions/session-1/history/archive_001/memory_diff.json",
          memories_extracted: { experiences: 1 }
        }
      } });
      return jsonResponse({ status: "ok", result: [
        "viking://user/local/memories/experiences/one.md",
        "viking://user/local/memories/experiences/two.md"
      ] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenVikingClient(configuration, undefined, NO_CREDENTIALS);

    await expect(client.getTask("task-1")).resolves.toMatchObject({
      status: "completed",
      result: { memories_extracted: { experiences: 1 } }
    });
    await expect(client.listDirectory("viking://user/memories/experiences", 2)).resolves.toHaveLength(2);
    expect(requestUrl(fetchMock.mock.calls[1]![0])).toContain("simple=true");
    expect(requestUrl(fetchMock.mock.calls[1]![0])).toContain("node_limit=2");
  });

  it("rejects malformed task and directory-listing receipts", async () => {
    const client = new OpenVikingClient(configuration, undefined, NO_CREDENTIALS);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "ok", result: {
      task_id: "task-1",
      task_type: "session_commit",
      status: "complete-ish"
    } })));
    await expect(client.getTask("task-1")).rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "ok", result: [7] })));
    await expect(client.listDirectory("viking://user/memories")).rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });
  });

  it("maps HTTP, service, network, timeout and malformed JSON failures", async () => {
    const client = new OpenVikingClient(configuration, undefined, NO_CREDENTIALS);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { message: "service down" } }, 503)));
    await expect(client.health()).rejects.toMatchObject({ code: "RUNTIME_NOT_READY", message: "service down" });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "error" })));
    await expect(client.health()).rejects.toMatchObject({ message: "OpenViking returned HTTP 200." });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    await expect(client.health()).rejects.toMatchObject({ message: "connection refused" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(client.health()).rejects.toMatchObject({ message: expect.stringContaining("800 ms timeout") });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    await expect(client.health()).resolves.toEqual({ latencyMs: expect.any(Number) });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
