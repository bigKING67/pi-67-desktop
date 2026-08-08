import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { grolandNativeSearchApi } from "@pi67/domain";
import { DEFAULT_FETCH_DEPENDENCIES, fetchPublicText, normalizeUrls } from "./first-party-web-fetch.js";
import {
  type FetchDependencies,
  MAX_FETCH_URLS,
  MAX_RESULT_CHARS,
  MAX_SEARCH_QUERIES,
  type SearchRequest,
  type SearchResult,
  type SearchToolDetails,
  asRecord,
  nonNegativeInteger,
  optionalString,
  positiveInteger,
  readBoundedResponseBytes,
  requiredString,
  stringArray
} from "./first-party-web-tool-contract.js";

const MAX_CACHE_ENTRIES = 32;

export type { SearchToolDetails } from "./first-party-web-tool-contract.js";

export type NativeSearchProtocol = "anthropic-web-search" | "openai-web-search" | "deepseek-web-search";

export interface NativeSearchRoute {
  kind: "native";
  protocol: NativeSearchProtocol;
  endpoint: string;
  sourceLabel: string;
}

interface CachedSearchResult extends SearchResult {
  responseId: string;
  createdAt: number;
}

export function resolveNativeSearchRoute(model: Pick<Model<any>, "provider" | "id" | "api" | "baseUrl">): NativeSearchRoute | undefined {
  if (model.provider === "deepseek") {
    if (model.id !== "deepseek-v4-flash") return undefined;
    return {
      kind: "native",
      protocol: "deepseek-web-search",
      endpoint: responsesEndpoint(model.baseUrl),
      sourceLabel: `模型原生 · DeepSeek · ${model.id}`
    };
  }
  const grolandApi = model.provider === "groland"
    ? grolandNativeSearchApi(model.id, model.api)
    : undefined;
  if (model.api === "anthropic-messages" && (model.provider === "anthropic" || grolandApi === model.api)) {
    return {
      kind: "native",
      protocol: "anthropic-web-search",
      endpoint: anthropicMessagesEndpoint(model.baseUrl),
      sourceLabel: `模型原生 · ${model.provider === "groland" ? "Groland" : "Anthropic"} · ${model.id}`
    };
  }
  if (model.api === "openai-responses" && (model.provider === "openai" || grolandApi === model.api)) {
    return {
      kind: "native",
      protocol: "openai-web-search",
      endpoint: responsesEndpoint(model.baseUrl),
      sourceLabel: `模型原生 · ${model.provider === "groland" ? "Groland" : "OpenAI"} · ${model.id}`
    };
  }
  return undefined;
}

export function createFirstPartyWebTools(
  dependencies: FetchDependencies = DEFAULT_FETCH_DEPENDENCIES
): ToolDefinition[] {
  const cache = new SearchResultCache();

  const webSearch: ToolDefinition = {
    name: "web_search",
    label: "Web search",
    description: "Search the current web through the selected model's declared provider-native search protocol.",
    promptSnippet: "Search the current web when the task needs current information or external evidence.",
    promptGuidelines: [
      "Decide automatically whether the task needs web search; there is no user-facing search switch.",
      "Use web_search once per distinct lookup and do not retry through another provider after any native-search failure."
    ],
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        query: { type: "string" },
        queries: { type: "array", items: { type: "string" }, maxItems: MAX_SEARCH_QUERIES },
        domainFilter: { type: "array", items: { type: "string" }, maxItems: 20 },
        numResults: { type: "integer", minimum: 1, maximum: 20 }
      }
    } as ToolDefinition["parameters"],
    executionMode: "parallel",
    async execute(_toolCallId, rawInput, signal, onUpdate, ctx) {
      const request = normalizeSearchRequest(rawInput);
      const model = ctx.model;
      const route = model ? resolveNativeSearchRoute(model) : undefined;
      if (!model || !route) {
        throw new Error(
          "NATIVE_WEB_SEARCH_UNAVAILABLE: the selected model does not declare a supported provider-native search route."
        );
      }
      onUpdate?.(toolResult("正在调用模型原生搜索…", {
        responseId: "pending",
        source: "provider-native",
        sourceLabel: route.sourceLabel,
        urls: []
      }));

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) {
        throw new Error(
          "NATIVE_WEB_SEARCH_CREDENTIAL_UNAVAILABLE: the selected model's native search credential is unavailable."
        );
      }
      const result = await executeNativeSearch(
        dependencies.fetch,
        route,
        model.id,
        auth.apiKey,
        auth.headers,
        request,
        signal
      );
      const cached = cache.put(result);
      return toolResult(formatSearchResult(cached), searchDetails(cached));
    }
  };

  const fetchContent: ToolDefinition = {
    name: "fetch_content",
    label: "Fetch web content",
    description: "Fetch one or more exact public HTTP(S) URLs with DNS and redirect SSRF protection.",
    promptSnippet: "Fetch exact public web URLs with bounded content extraction.",
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        url: { type: "string" },
        urls: { type: "array", items: { type: "string" }, maxItems: MAX_FETCH_URLS }
      }
    } as ToolDefinition["parameters"],
    executionMode: "parallel",
    async execute(_toolCallId, rawInput, signal) {
      const urls = normalizeUrls(rawInput);
      const documents = [];
      for (const url of urls) documents.push(await fetchPublicText(url, dependencies, signal));
      const text = documents.map((document) => (
        `## ${document.url}\n\n${document.text}`
      )).join("\n\n").slice(0, MAX_RESULT_CHARS);
      const cached = cache.put({
        text,
        urls: documents.map((document) => document.url),
        source: "direct-fetch",
        sourceLabel: "Pi-67 · 安全抓取"
      });
      return toolResult(formatSearchResult(cached), searchDetails(cached));
    }
  };

  const getSearchContent: ToolDefinition = {
    name: "get_search_content",
    label: "Get search content",
    description: "Read a bounded slice of a previous Pi-67 search or fetch result by responseId.",
    parameters: {
      type: "object",
      additionalProperties: true,
      required: ["responseId"],
      properties: {
        responseId: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: MAX_RESULT_CHARS }
      }
    } as ToolDefinition["parameters"],
    executionMode: "parallel",
    async execute(_toolCallId, rawInput) {
      const record = asRecord(rawInput);
      const responseId = requiredString(record.responseId, "responseId");
      const cached = cache.get(responseId);
      if (!cached) throw new Error("SEARCH_RESPONSE_NOT_FOUND: the bounded search cache no longer contains this responseId.");
      const offset = nonNegativeInteger(record.offset) ?? 0;
      const limit = positiveInteger(record.limit) ?? MAX_RESULT_CHARS;
      const text = cached.text.slice(offset, offset + Math.min(limit, MAX_RESULT_CHARS));
      return toolResult(text || "(empty result slice)", {
        responseId,
        source: "cache",
        sourceLabel: cached.sourceLabel,
        urls: cached.urls
      });
    }
  };

  const sourceCheck: ToolDefinition = {
    name: "source_check",
    label: "Check sources",
    description: "Search the web for evidence related to a claim through the selected model's provider-native search.",
    parameters: {
      type: "object",
      additionalProperties: true,
      required: ["claim"],
      properties: {
        claim: { type: "string" },
        queries: { type: "array", items: { type: "string" }, maxItems: MAX_SEARCH_QUERIES },
        domainFilter: { type: "array", items: { type: "string" }, maxItems: 20 }
      }
    } as ToolDefinition["parameters"],
    executionMode: "parallel",
    async execute(toolCallId, rawInput, signal, onUpdate, ctx) {
      const record = asRecord(rawInput);
      const claim = requiredString(record.claim, "claim");
      const queries = stringArray(record.queries, MAX_SEARCH_QUERIES);
      return webSearch.execute(toolCallId, {
        query: queries.length > 0 ? undefined : claim,
        queries: queries.length > 0 ? queries : undefined,
        domainFilter: stringArray(record.domainFilter, 20)
      }, signal, onUpdate, ctx);
    }
  };

  return [webSearch, fetchContent, getSearchContent, sourceCheck];
}

export async function executeNativeSearch(
  fetchImpl: typeof globalThis.fetch,
  route: NativeSearchRoute,
  modelId: string,
  apiKey: string,
  inheritedHeaders: Record<string, string> | undefined,
  request: SearchRequest,
  signal?: AbortSignal
): Promise<SearchResult> {
  const headers = new Headers(inheritedHeaders);
  headers.set("content-type", "application/json");
  let body: Record<string, unknown>;
  if (route.protocol === "anthropic-web-search") {
    headers.set("x-api-key", apiKey);
    headers.set("anthropic-version", "2023-06-01");
    body = {
      model: modelId,
      max_tokens: 4096,
      messages: [{ role: "user", content: request.queries.join("\n\n") }],
      tools: [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: Math.min(request.numResults, 10),
        ...(request.domainFilter?.length ? { allowed_domains: request.domainFilter } : {})
      }]
    };
  } else {
    headers.set("authorization", `Bearer ${apiKey}`);
    body = {
      model: modelId,
      input: request.queries.join("\n\n"),
      tools: [{ type: "web_search" }]
    };
  }

  const response = await fetchImpl(route.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    ...(signal ? { signal } : {})
  });
  if (!response.ok) {
    throw new Error(`NATIVE_WEB_SEARCH_FAILED: ${route.sourceLabel} returned HTTP ${response.status}; no alternate search provider was called.`);
  }
  const payload = await parseBoundedJson(
    response,
    "NATIVE_WEB_SEARCH_RESPONSE_TOO_LARGE: provider response exceeds the 2 MiB limit.",
    "NATIVE_WEB_SEARCH_INVALID: provider returned malformed JSON."
  );
  const projected = route.protocol === "anthropic-web-search"
    ? projectAnthropicSearchResponse(payload)
    : projectResponsesSearchResponse(payload);
  if (!projected.text.trim()) {
    throw new Error(`NATIVE_WEB_SEARCH_EMPTY: ${route.sourceLabel} returned no searchable answer; no alternate search provider was called.`);
  }
  return { ...projected, source: "provider-native", sourceLabel: route.sourceLabel };
}

function projectAnthropicSearchResponse(payload: unknown): Pick<SearchResult, "text" | "urls"> {
  const record = asRecord(payload);
  const content = Array.isArray(record.content) ? record.content : [];
  const text: string[] = [];
  const urls = new Set<string>();
  for (const item of content) {
    const block = asRecord(item);
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    collectUrls(block, urls);
  }
  return { text: text.join("\n\n").slice(0, MAX_RESULT_CHARS), urls: [...urls] };
}

function projectResponsesSearchResponse(payload: unknown): Pick<SearchResult, "text" | "urls"> {
  const record = asRecord(payload);
  const text: string[] = [];
  const urls = new Set<string>();
  if (typeof record.output_text === "string") text.push(record.output_text);
  const output = Array.isArray(record.output) ? record.output : [];
  for (const item of output) {
    const block = asRecord(item);
    const content = Array.isArray(block.content) ? block.content : [];
    for (const part of content) {
      const projected = asRecord(part);
      if (projected.type === "output_text" && typeof projected.text === "string") text.push(projected.text);
      collectUrls(projected, urls);
    }
    collectUrls(block, urls);
  }
  return { text: [...new Set(text)].join("\n\n").slice(0, MAX_RESULT_CHARS), urls: [...urls] };
}

function collectUrls(value: unknown, target: Set<string>, depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, target, depth + 1);
    return;
  }
  const record = asRecord(value);
  for (const [key, child] of Object.entries(record)) {
    if ((key === "url" || key === "source") && typeof child === "string" && /^https?:\/\//u.test(child)) {
      target.add(child);
    } else if (typeof child === "object" && child !== null) {
      collectUrls(child, target, depth + 1);
    }
  }
}

async function parseBoundedJson(
  response: Response,
  tooLargeMessage: string,
  malformedMessage: string
): Promise<unknown> {
  const bytes = await readBoundedResponseBytes(response, tooLargeMessage);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(malformedMessage);
  }
}

function anthropicMessagesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/u, "").replace(/\/v1\/messages$/u, "");
  return `${normalized}/v1/messages`;
}

function responsesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/u, "").replace(/\/responses$/u, "");
  return `${normalized}/responses`;
}

function normalizeSearchRequest(input: unknown): SearchRequest {
  const record = asRecord(input);
  const queries = stringArray(record.queries, MAX_SEARCH_QUERIES);
  const single = optionalString(record.query);
  const normalized = queries.length > 0 ? queries : single ? [single] : [];
  if (normalized.length === 0) throw new Error("WEB_SEARCH_QUERY_REQUIRED: provide query or queries.");
  const domainFilter = stringArray(record.domainFilter, 20);
  return {
    queries: normalized,
    ...(domainFilter.length > 0 ? { domainFilter } : {}),
    numResults: Math.min(20, positiveInteger(record.numResults) ?? 8)
  };
}

function formatSearchResult(result: CachedSearchResult): string {
  const sources = result.urls.length > 0
    ? `\n\nSources:\n${result.urls.map((url, index) => `${index + 1}. ${url}`).join("\n")}`
    : "";
  return `[${result.sourceLabel}]\nresponseId: ${result.responseId}\n\n${result.text}${sources}`;
}

function searchDetails(result: CachedSearchResult): SearchToolDetails {
  return {
    responseId: result.responseId,
    source: result.source,
    sourceLabel: result.sourceLabel,
    urls: result.urls
  };
}

function toolResult(text: string, details: SearchToolDetails) {
  return { content: [{ type: "text" as const, text }], details };
}

class SearchResultCache {
  private readonly results = new Map<string, CachedSearchResult>();

  put(result: SearchResult): CachedSearchResult {
    const cached = { ...result, responseId: randomUUID(), createdAt: Date.now() };
    this.results.set(cached.responseId, cached);
    while (this.results.size > MAX_CACHE_ENTRIES) {
      const oldest = this.results.keys().next().value as string | undefined;
      if (!oldest) break;
      this.results.delete(oldest);
    }
    return cached;
  }

  get(responseId: string): CachedSearchResult | undefined {
    return this.results.get(responseId);
  }
}
