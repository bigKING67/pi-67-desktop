import { randomUUID } from "node:crypto";
import {
  MAX_RESULT_CHARS,
  type SearchRequest,
  type SearchResult,
  asRecord,
  readBoundedResponseBytes
} from "./first-party-web-tool-contract.js";

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";
const EXA_MCP_PROTOCOL_VERSION = "2025-06-18";
const EXA_MCP_CLIENT_INFO = Object.freeze({ name: "pi-67-desktop", version: "0.1.0" });

export async function executeExaSearch(
  fetchImpl: typeof globalThis.fetch,
  request: SearchRequest,
  signal?: AbortSignal
): Promise<SearchResult> {
  const tool = request.domainFilter?.length ? "web_search_advanced_exa" : "web_search_exa";
  const args: Record<string, unknown> = {
    query: request.queries.join("\n\n"),
    numResults: request.numResults,
    ...(request.domainFilter?.length ? { includeDomains: request.domainFilter } : {})
  };
  const initializeId = randomUUID();
  const initializeResponse = await sendExaMcpRequest(fetchImpl, {
    jsonrpc: "2.0",
    id: initializeId,
    method: "initialize",
    params: {
      protocolVersion: EXA_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: EXA_MCP_CLIENT_INFO
    }
  }, "initialize", signal);
  const initializeResult = mcpResult(
    await parseMcpResponse(initializeResponse, initializeId, "initialize"),
    "initialize"
  );
  if (initializeResult.protocolVersion !== EXA_MCP_PROTOCOL_VERSION) {
    throw new Error("EXA_MCP_INITIALIZE_FAILED: server negotiated an unsupported protocol version.");
  }
  const sessionId = validMcpSessionId(initializeResponse.headers.get("mcp-session-id"));

  const initializedResponse = await sendExaMcpRequest(fetchImpl, {
    jsonrpc: "2.0",
    method: "notifications/initialized"
  }, "initialized", signal, sessionId);
  if (initializedResponse.status !== 202) {
    throw new Error(`EXA_MCP_INITIALIZED_FAILED: expected HTTP 202, received ${initializedResponse.status}.`);
  }

  const toolCallId = randomUUID();
  const toolResponse = await sendExaMcpRequest(fetchImpl, {
    jsonrpc: "2.0",
    id: toolCallId,
    method: "tools/call",
    params: { name: tool, arguments: args }
  }, "tools-call", signal, sessionId);
  const result = mcpResult(
    await parseMcpResponse(toolResponse, toolCallId, "tools-call"),
    "tools-call"
  );
  if (result.isError === true) {
    throw new Error(`EXA_WEB_SEARCH_FAILED: ${boundedErrorDetail(mcpText(result)) || "unknown MCP tool error"}`);
  }
  const text = mcpText(result).slice(0, MAX_RESULT_CHARS);
  if (!text) throw new Error("EXA_WEB_SEARCH_EMPTY: Pi-67 fallback returned no search content.");
  return {
    text,
    urls: extractUrls(text),
    source: "exa",
    sourceLabel: "Pi-67 回退 · Exa"
  };
}

async function sendExaMcpRequest(
  fetchImpl: typeof globalThis.fetch,
  body: Record<string, unknown>,
  stage: "initialize" | "initialized" | "tools-call",
  signal?: AbortSignal,
  sessionId?: string
): Promise<Response> {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json"
  });
  if (sessionId) {
    headers.set("mcp-session-id", sessionId);
    headers.set("mcp-protocol-version", EXA_MCP_PROTOCOL_VERSION);
  }
  let response: Response;
  try {
    response = await fetchImpl(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {})
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`EXA_MCP_${stage.toLocaleUpperCase("en-US").replace("-", "_")}_FAILED: network request failed.`);
  }
  if (!response.ok) {
    throw new Error(`EXA_MCP_${stage.toLocaleUpperCase("en-US").replace("-", "_")}_FAILED: HTTP ${response.status}.`);
  }
  return response;
}

async function parseMcpResponse(
  response: Response,
  expectedId: string,
  stage: "initialize" | "tools-call"
): Promise<Record<string, unknown>> {
  const bytes = await readBoundedResponseBytes(
    response,
    `EXA_MCP_${stage.toLocaleUpperCase("en-US").replace("-", "_")}_FAILED: response exceeds the 2 MiB limit.`
  );
  const body = new TextDecoder().decode(bytes);
  let payloads: unknown[];
  try {
    payloads = response.headers.get("content-type")?.includes("text/event-stream")
      ? parseServerSentJson(body)
      : flattenJsonRpcPayload(JSON.parse(body) as unknown);
  } catch {
    throw new Error(`EXA_MCP_${stage.toLocaleUpperCase("en-US").replace("-", "_")}_FAILED: malformed JSON response.`);
  }
  const responsePayload = payloads.map(asRecord).find((payload) => payload.id === expectedId);
  if (!responsePayload || responsePayload.jsonrpc !== "2.0") {
    throw new Error(`EXA_MCP_${stage.toLocaleUpperCase("en-US").replace("-", "_")}_FAILED: response id or JSON-RPC version did not match.`);
  }
  return responsePayload;
}

function parseServerSentJson(body: string): unknown[] {
  const payloads: unknown[] = [];
  for (const event of body.split(/\r?\n\r?\n/u)) {
    const data = event.split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    payloads.push(...flattenJsonRpcPayload(JSON.parse(data) as unknown));
  }
  return payloads;
}

function flattenJsonRpcPayload(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : [payload];
}

function mcpResult(payload: Record<string, unknown>, stage: "initialize" | "tools-call"): Record<string, unknown> {
  if (payload.error !== undefined) {
    throw new Error(
      `EXA_MCP_${stage.toLocaleUpperCase("en-US").replace("-", "_")}_FAILED: ${mcpErrorDetail(payload.error)}`
    );
  }
  if (typeof payload.result !== "object" || payload.result === null) {
    throw new Error(`EXA_MCP_${stage.toLocaleUpperCase("en-US").replace("-", "_")}_FAILED: response contained no result.`);
  }
  return asRecord(payload.result);
}

function mcpErrorDetail(error: unknown): string {
  const record = asRecord(error);
  const code = typeof record.code === "number" || typeof record.code === "string"
    ? String(record.code)
    : "unknown";
  const message = boundedErrorDetail(typeof record.message === "string" ? record.message : "unknown MCP error");
  return `${code} ${message}`;
}

function boundedErrorDetail(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 400);
}

function validMcpSessionId(value: string | null): string {
  const sessionId = value?.trim();
  let containsControlCharacter = false;
  for (let index = 0; index < (sessionId?.length ?? 0); index += 1) {
    const code = sessionId?.charCodeAt(index) ?? 0;
    if (code <= 31 || code === 127) {
      containsControlCharacter = true;
      break;
    }
  }
  if (!sessionId || sessionId.length > 256 || containsControlCharacter) {
    throw new Error("EXA_MCP_INITIALIZE_FAILED: response contained no valid mcp-session-id.");
  }
  return sessionId;
}

function mcpText(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.flatMap((item) => {
    const block = asRecord(item);
    return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
  }).join("\n\n");
}

function extractUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>"')\]]+/gu) ?? [])].slice(0, 100);
}
