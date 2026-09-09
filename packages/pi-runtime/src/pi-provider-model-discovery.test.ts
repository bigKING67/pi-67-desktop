import type { PiProviderModelDiscoveryInput } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { PiProviderModelDiscovery } from "./pi-provider-model-discovery.js";

const BASE_INPUT: PiProviderModelDiscoveryInput = {
  provider: "gateway",
  baseUrl: "http://127.0.0.1:8317/v1",
  protocols: ["openai", "anthropic", "gemini"],
  openAiApi: "openai-responses",
  apiKey: "fixture-discovery-secret"
};

describe("Pi Provider model discovery", () => {
  it("reads one shared Bearer catalog into three protocol families with Responses preferred", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ data: [
      { id: "vendor-a/gpt-5", owned_by: "vendor-a" },
      { id: "vendor-b/gpt-5", owned_by: "vendor-b" },
      { id: "claude-sonnet-4-6", owned_by: "anthropic" },
      { id: "gemini-2.5-pro", owned_by: "google" }
    ] }));
    const discovery = new PiProviderModelDiscovery({
      fetch: fetcher,
      resolveCredential: vi.fn()
    });

    const result = await discovery.inspect(BASE_INPUT);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.every(([url]) => requestUrl(url) === "http://127.0.0.1:8317/v1/models")).toBe(true);
    expect(result.status).toBe("current");
    expect(result.models).toEqual([
      expect.objectContaining({ id: "vendor-a/gpt-5", protocol: "openai", api: "openai-responses" }),
      expect.objectContaining({ id: "vendor-b/gpt-5", protocol: "openai", api: "openai-responses" }),
      expect.objectContaining({ id: "claude-sonnet-4-6", protocol: "anthropic", api: "anthropic-messages" }),
      expect.objectContaining({ id: "gemini-2.5-pro", protocol: "gemini", api: "google-generative-ai" })
    ]);
    expect(result.models.every((model) => model.discoveredBy.length === 3)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-discovery-secret");
    const [, request] = fetcher.mock.calls[0]!;
    const headers = new Headers(request?.headers);
    expect(headers.get("authorization")).toBe("Bearer fixture-discovery-secret");
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.has("x-goog-api-key")).toBe(false);
  });

  it("keeps protocol-native catalog headers as an explicit compatibility mode", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ data: [] }));
    const discovery = new PiProviderModelDiscovery({ fetch: fetcher, resolveCredential: vi.fn() });

    await discovery.inspect({ ...BASE_INPUT, authHeader: false });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization"))
      .toBe("Bearer fixture-discovery-secret");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("x-api-key"))
      .toBe("fixture-discovery-secret");
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get("x-goog-api-key"))
      .toBe("fixture-discovery-secret");
  });

  it("does not mix protocol-native alias catalogs into the default aggregate result", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.has("x-api-key")) {
        return jsonResponse({ data: [{ id: "claude-fable-gpt", display_name: "GPT route" }] });
      }
      return jsonResponse({ data: [
        { id: "gpt-5", owned_by: "openai" },
        { id: "claude-sonnet-4-6", owned_by: "anthropic" },
        { id: "gemini-3-pro", owned_by: "google" }
      ] });
    });
    const discovery = new PiProviderModelDiscovery({ fetch: fetcher, resolveCredential: vi.fn() });

    const result = await discovery.inspect(BASE_INPUT);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.models.map((model) => model.id)).toEqual([
      "gpt-5",
      "claude-sonnet-4-6",
      "gemini-3-pro"
    ]);
    expect(result.models.some((model) => model.id.startsWith("claude-fable-"))).toBe(false);
  });

  it("does not import an unchecked Anthropic family and supports explicit Chat Completions", async () => {
    const discovery = new PiProviderModelDiscovery({
      fetch: vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ data: [
        { id: "gpt-compatible" },
        { id: "claude-hidden" },
        { id: "gemini-visible" }
      ] })),
      resolveCredential: vi.fn()
    });

    const result = await discovery.inspect({
      ...BASE_INPUT,
      protocols: ["openai", "gemini"],
      openAiApi: "openai-completions"
    });

    expect(result.models.map((model) => model.id)).toEqual(["gpt-compatible", "gemini-visible"]);
    expect(result.models[0]?.api).toBe("openai-completions");
    expect(result.families.map((family) => family.protocol)).toEqual(["openai", "gemini"]);
  });

  it("keeps partial family failures visible when a shared catalog still identifies models", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.has("x-api-key")) return new Response("", { status: 401 });
      return jsonResponse({ data: [{ id: "claude-opus-4-6" }, { id: "gpt-5" }] });
    });
    const discovery = new PiProviderModelDiscovery({ fetch: fetcher, resolveCredential: vi.fn() });

    const result = await discovery.inspect({ ...BASE_INPUT, authHeader: false });

    expect(result.status).toBe("partial");
    expect(result.families).toContainEqual({
      protocol: "anthropic",
      status: "shared",
      modelCount: 1,
      message: "从其他已选协议返回的共享模型目录中识别。"
    });
    expect(result.models).toContainEqual(expect.objectContaining({
      id: "claude-opus-4-6",
      api: "anthropic-messages"
    }));
  });

  it("marks a family as shared when its own successful catalog is empty", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "claude-sonnet-4-6" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const discovery = new PiProviderModelDiscovery({ fetch: fetcher, resolveCredential: vi.fn() });

    const result = await discovery.inspect({ ...BASE_INPUT, authHeader: false });

    expect(result.status).toBe("current");
    expect(result.families).toContainEqual({
      protocol: "anthropic",
      status: "shared",
      modelCount: 1,
      message: "从其他已选协议返回的共享模型目录中识别。"
    });
  });

  it("rejects same-ID supplier collisions instead of inventing routable aliases", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-5", owned_by: "supplier-a" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-5", owned_by: "supplier-b" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const discovery = new PiProviderModelDiscovery({ fetch: fetcher, resolveCredential: vi.fn() });

    const result = await discovery.inspect({ ...BASE_INPUT, authHeader: false });

    expect(result.status).toBe("partial");
    expect(result.models).toEqual([]);
    expect(result.conflicts).toEqual([{
      id: "gpt-5",
      suppliers: ["supplier-a", "supplier-b"],
      reason: "supplier-id-collision"
    }]);
  });

  it("uses a stored credential when the draft does not contain a transient key", async () => {
    const resolveCredential = vi.fn(async () => "stored-fixture-secret");
    const fetcher = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ models: [{ name: "models/gemini-2.5-flash" }] }));
    const discovery = new PiProviderModelDiscovery({ fetch: fetcher, resolveCredential });

    const { apiKey: _apiKey, ...withoutTransientKey } = BASE_INPUT;
    const result = await discovery.inspect({ ...withoutTransientKey, protocols: ["gemini"] });

    expect(resolveCredential).toHaveBeenCalledWith("gateway");
    expect(result.models).toEqual([expect.objectContaining({
      id: "gemini-2.5-flash",
      protocol: "gemini",
      api: "google-generative-ai"
    })]);
  });

  it("can cancel while an existing credential is still being resolved", async () => {
    let finishCredential: ((value: string) => void) | undefined;
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const discovery = new PiProviderModelDiscovery({
      fetch: fetcher,
      resolveCredential: () => new Promise<string>((resolve) => {
        finishCredential = resolve;
      })
    });
    const { apiKey: _apiKey, ...withoutTransientKey } = BASE_INPUT;

    const pending = discovery.inspect(withoutTransientKey);
    expect(discovery.cancel()).toBe(true);
    finishCredential?.("stored-fixture-secret");

    await expect(pending).resolves.toEqual(expect.objectContaining({
      status: "failed",
      models: []
    }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bounds catalog bodies before parsing", async () => {
    const discovery = new PiProviderModelDiscovery({
      fetch: vi.fn<typeof globalThis.fetch>(async () => new Response("x".repeat(64), {
        headers: { "content-length": "64" }
      })),
      maxResponseBytes: 16,
      resolveCredential: vi.fn()
    });

    const result = await discovery.inspect({ ...BASE_INPUT, protocols: ["openai"] });

    expect(result.status).toBe("failed");
    expect(result.families[0]?.message).toBe("模型目录响应超过安全大小限制。");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
