import { asRecord, MAX_RESPONSE_BYTES } from "./first-party-web-tool-contract.js";

export type DeepSeekWebSearchState = "in_progress" | "searching" | "completed";

const SEARCH_EVENT_STATES = new Map<string, DeepSeekWebSearchState>([
  ["response.web_search_call.in_progress", "in_progress"],
  ["response.web_search_call.searching", "searching"],
  ["response.web_search_call.completed", "completed"]
]);

export async function readDeepSeekResponsesStream(
  response: Response,
  onSearchState?: (state: DeepSeekWebSearchState) => void
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw responseTooLarge();
  }
  if (!response.body) throw invalidResponse();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const observedStates = new Set<DeepSeekWebSearchState>();
  let buffered = "";
  let total = 0;
  let terminalPayload: unknown;

  const acceptBlock = (block: string): void => {
    const event = parseEventBlock(block);
    if (!event) return;
    const type = typeof event.payload.type === "string"
      ? event.payload.type
      : typeof event.payload.event === "string"
        ? event.payload.event
        : event.eventName;
    const state = type ? SEARCH_EVENT_STATES.get(type) : undefined;
    if (state && !observedStates.has(state)) {
      observedStates.add(state);
      onSearchState?.(state);
    }
    if (type === "response.completed") {
      terminalPayload = event.payload.response ?? event.payload;
    } else if (type === "response.incomplete") {
      throw new Error("NATIVE_WEB_SEARCH_INCOMPLETE: DeepSeek ended the Responses stream before completing the search.");
    } else if (type === "response.failed") {
      throw new Error("NATIVE_WEB_SEARCH_FAILED: DeepSeek reported a failed Responses stream; no alternate search provider was called.");
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded read already failed; cancellation is best-effort cleanup.
        }
        throw responseTooLarge();
      }
      buffered = `${buffered}${decoder.decode(value, { stream: true })}`.replaceAll("\r\n", "\n");
      let boundary = buffered.indexOf("\n\n");
      while (boundary >= 0) {
        acceptBlock(buffered.slice(0, boundary));
        buffered = buffered.slice(boundary + 2);
        boundary = buffered.indexOf("\n\n");
      }
    }
    buffered = `${buffered}${decoder.decode()}`.replaceAll("\r\n", "\n");
    if (buffered.trim()) acceptBlock(buffered);
  } finally {
    reader.releaseLock();
  }

  if (terminalPayload === undefined) throw invalidResponse();
  return terminalPayload;
}

function parseEventBlock(block: string): { eventName?: string; payload: Record<string, unknown> } | undefined {
  let eventName: string | undefined;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  try {
    const payload = asRecord(JSON.parse(data.join("\n")) as unknown);
    if (Object.keys(payload).length === 0) throw invalidResponse();
    return { ...(eventName ? { eventName } : {}), payload };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NATIVE_WEB_SEARCH_")) throw error;
    throw invalidResponse();
  }
}

function responseTooLarge(): Error {
  return new Error("NATIVE_WEB_SEARCH_RESPONSE_TOO_LARGE: provider response exceeds the 2 MiB limit.");
}

function invalidResponse(): Error {
  return new Error("NATIVE_WEB_SEARCH_INVALID: DeepSeek returned a malformed or unterminated Responses stream.");
}
