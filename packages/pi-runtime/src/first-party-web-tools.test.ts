import { describe, expect, it, vi } from "vitest";
import {
  createFirstPartyWebTools,
  executeNativeSearch,
  resolveNativeSearchRoute
} from "./first-party-web-tools.js";

describe("first-party web tools", () => {
  it("routes Groland models to their model-level native protocols without duplicate endpoint suffixes", () => {
    expect(resolveNativeSearchRoute({
      provider: "groland",
      id: "claude-sonnet-5",
      api: "anthropic-messages",
      baseUrl: "https://api.sciencetoken.ai/proxy/anthropic"
    })).toMatchObject({
      protocol: "anthropic-web-search",
      endpoint: "https://api.sciencetoken.ai/proxy/anthropic/v1/messages"
    });
    expect(resolveNativeSearchRoute({
      provider: "groland",
      id: "gpt-5.5",
      api: "openai-responses",
      baseUrl: "https://api.sciencetoken.ai/proxy/openai/v1/responses"
    })).toMatchObject({
      protocol: "openai-web-search",
      endpoint: "https://api.sciencetoken.ai/proxy/openai/v1/responses"
    });
    expect(resolveNativeSearchRoute({
      provider: "groland",
      id: "custom-model",
      api: "openai-responses",
      baseUrl: "https://api.sciencetoken.ai/proxy/openai/v1"
    })).toBeUndefined();
    expect(resolveNativeSearchRoute({
      provider: "groland",
      id: "claude-sonnet-5",
      api: "openai-responses",
      baseUrl: "https://api.sciencetoken.ai/proxy/openai/v1"
    })).toBeUndefined();
  });

  it("does not mark unsupported DeepSeek models as native-search capable", () => {
    expect(resolveNativeSearchRoute({
      provider: "deepseek",
      id: "deepseek-v4-pro",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com/v1"
    })).toBeUndefined();
    expect(resolveNativeSearchRoute({
      provider: "deepseek",
      id: "deepseek-v4-flash",
      api: "openai-responses",
      baseUrl: "https://api.deepseek.com/v1"
    })?.endpoint).toBe("https://api.deepseek.com/v1/responses");
  });

  it("uses x-api-key for Anthropic and extracts citations", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("fixture-key");
      expect(headers.get("authorization")).toBeNull();
      return new Response(JSON.stringify({
        content: [{
          type: "text",
          text: "Current answer",
          citations: [{ type: "web_search_result_location", url: "https://example.test/source" }]
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const route = resolveNativeSearchRoute({
      provider: "groland",
      id: "claude-opus-4-6",
      api: "anthropic-messages",
      baseUrl: "https://api.sciencetoken.ai/proxy/anthropic"
    });
    if (!route) throw new Error("missing route");
    const result = await executeNativeSearch(fetchImpl as typeof fetch, route, "claude-opus-4-6", "fixture-key", undefined, {
      queries: ["current answer"],
      numResults: 5
    });
    expect(result.text).toBe("Current answer");
    expect(result.urls).toEqual(["https://example.test/source"]);
  });

  it("uses Bearer for Responses and refuses silent Exa resend after a sent request fails", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer fixture-key");
      expect(headers.get("x-api-key")).toBeNull();
      return new Response("quota", { status: 429 });
    });
    const route = resolveNativeSearchRoute({
      provider: "groland",
      id: "gpt-5.5",
      api: "openai-responses",
      baseUrl: "https://api.sciencetoken.ai/proxy/openai/v1"
    });
    if (!route) throw new Error("missing route");
    await expect(executeNativeSearch(fetchImpl as typeof fetch, route, "gpt-5.5", "fixture-key", undefined, {
      queries: ["current answer"],
      numResults: 5
    })).rejects.toThrow(/not resent to Exa/iu);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("runs a bounded Streamable HTTP MCP lifecycle for each Exa fallback search", async () => {
    const controller = new AbortController();
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      const request = requestBody(init) as { id?: string; method: string; params?: Record<string, unknown> };
      const headers = new Headers(init?.headers);
      methods.push(request.method);
      if (request.method === "initialize") {
        expect(headers.get("mcp-session-id")).toBeNull();
        expect(request.params).toMatchObject({
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "pi-67-desktop" }
        });
        return jsonResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "exa" } }
        }, { "mcp-session-id": "exa-session-1" });
      }
      expect(headers.get("mcp-session-id")).toBe("exa-session-1");
      expect(headers.get("mcp-protocol-version")).toBe("2025-06-18");
      if (request.method === "notifications/initialized") {
        expect(request.id).toBeUndefined();
        return new Response(null, { status: 202 });
      }
      expect(request.method).toBe("tools/call");
      expect(request.params).toMatchObject({ name: "web_search_exa" });
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: "Current result https://example.test/source" }]
        }
      });
      return new Response(`event: message\ndata: ${payload}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    });

    const result = await executeTool(
      "web_search",
      { fetch: fetchImpl as typeof fetch, resolveAddresses: async () => ["93.184.216.34"] },
      { query: "current result", numResults: 3 },
      controller.signal
    );

    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Current result") });
  });

  it("projects explicit Exa lifecycle errors before tools/call", async () => {
    const missingSessionFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = requestBody(init) as { id?: string };
      return jsonResponse({
        jsonrpc: "2.0",
        id: request.id,
        result: { protocolVersion: "2025-06-18", capabilities: {} }
      });
    });
    await expect(executeTool(
      "web_search",
      { fetch: missingSessionFetch as typeof fetch, resolveAddresses: async () => ["93.184.216.34"] },
      { query: "current result" }
    )).rejects.toThrow(/no valid mcp-session-id/iu);
    expect(missingSessionFetch).toHaveBeenCalledOnce();

    const notificationFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = requestBody(init) as { id?: string; method: string };
      if (request.method === "initialize") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: { protocolVersion: "2025-06-18", capabilities: {} }
        }, { "mcp-session-id": "exa-session-2" });
      }
      return new Response("rejected", { status: 409 });
    });
    await expect(executeTool(
      "web_search",
      { fetch: notificationFetch as typeof fetch, resolveAddresses: async () => ["93.184.216.34"] },
      { query: "current result" }
    )).rejects.toThrow(/EXA_MCP_INITIALIZED_FAILED: HTTP 409/iu);
    expect(notificationFetch).toHaveBeenCalledTimes(2);
  });

  it("re-resolves every redirect and rejects private, mapped, reserved, or empty DNS results", async () => {
    const resolveAddresses = vi.fn(async (hostname: string) => (
      hostname === "public.example" ? ["93.184.216.34"] : ["10.0.0.8"]
    ));
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://private.example/secret" }
    }));
    await expect(executeTool(
      "fetch_content",
      { fetch: fetchImpl as typeof fetch, resolveAddresses },
      { url: "https://public.example/start" }
    )).rejects.toThrow(/FETCH_SSRF_REJECTED/iu);
    expect(resolveAddresses).toHaveBeenNthCalledWith(1, "public.example");
    expect(resolveAddresses).toHaveBeenNthCalledWith(2, "private.example");
    expect(fetchImpl).toHaveBeenCalledOnce();

    for (const address of ["::ffff:127.0.0.1", "100.64.0.1", "198.51.100.8", "2001:db8::1"]) {
      const blockedFetch = vi.fn();
      await expect(executeTool(
        "fetch_content",
        { fetch: blockedFetch as typeof fetch, resolveAddresses: async () => [address] },
        { url: "https://blocked.example/value" }
      )).rejects.toThrow(/FETCH_SSRF_REJECTED/iu);
      expect(blockedFetch).not.toHaveBeenCalled();
    }

    await expect(executeTool(
      "fetch_content",
      { fetch: vi.fn() as typeof fetch, resolveAddresses: async () => [] },
      { url: "https://empty.example/value" }
    )).rejects.toThrow(/FETCH_SSRF_REJECTED/iu);
  });

  it("rejects URL credentials, excessive redirects, and streamed responses over 2 MiB", async () => {
    const noFetch = vi.fn();
    await expect(executeTool(
      "fetch_content",
      { fetch: noFetch as typeof fetch, resolveAddresses: async () => ["93.184.216.34"] },
      { url: "https://user:password@example.test/private" }
    )).rejects.toThrow(/credential-free/iu);
    expect(noFetch).not.toHaveBeenCalled();

    const redirectFetch = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request
        ? new URL(input.url)
        : typeof input === "string"
          ? new URL(input)
          : input;
      const next = Number.parseInt(url.searchParams.get("step") ?? "0", 10) + 1;
      return new Response(null, { status: 302, headers: { location: `/?step=${next}` } });
    });
    await expect(executeTool(
      "fetch_content",
      { fetch: redirectFetch as typeof fetch, resolveAddresses: async () => ["93.184.216.34"] },
      { url: "https://redirect.example/?step=0" }
    )).rejects.toThrow(/redirect chain is incomplete or too long/iu);
    expect(redirectFetch).toHaveBeenCalledTimes(4);

    const oversizedFetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        controller.close();
      }
    }), { status: 200, headers: { "content-type": "text/plain" } }));
    await expect(executeTool(
      "fetch_content",
      { fetch: oversizedFetch as typeof fetch, resolveAddresses: async () => ["93.184.216.34"] },
      { url: "https://large.example/content" }
    )).rejects.toThrow(/FETCH_CONTENT_TOO_LARGE/iu);
  });
});

type WebToolDependencies = NonNullable<Parameters<typeof createFirstPartyWebTools>[0]>;

async function executeTool(
  name: "web_search" | "fetch_content",
  dependencies: WebToolDependencies,
  input: Record<string, unknown>,
  signal?: AbortSignal
) {
  const tool = createFirstPartyWebTools(dependencies).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing ${name} Tool.`);
  return tool.execute("test-tool-call", input, signal, undefined, { model: undefined } as never);
}

function jsonResponse(payload: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", ...headers }
  });
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON string request body.");
  return JSON.parse(init.body) as Record<string, unknown>;
}
