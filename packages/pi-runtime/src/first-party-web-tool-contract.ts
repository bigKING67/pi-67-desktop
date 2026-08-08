export const MAX_SEARCH_QUERIES = 5;
export const MAX_FETCH_URLS = 5;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_RESULT_CHARS = 60_000;

export interface SearchToolDetails {
  responseId: string;
  source: "provider-native" | "exa" | "direct-fetch" | "cache";
  sourceLabel: string;
  urls: string[];
}

export interface SearchRequest {
  queries: string[];
  domainFilter?: string[];
  numResults: number;
}

export interface SearchResult {
  text: string;
  urls: string[];
  source: SearchToolDetails["source"];
  sourceLabel: string;
}

export interface FetchDependencies {
  fetch: typeof globalThis.fetch;
  resolveAddresses(hostname: string): Promise<string[]>;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requiredString(value: unknown, name: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${name} must be a non-empty string.`);
  return result;
}

export function stringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => optionalString(item) ?? []).slice(0, limit);
}

export function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export async function readBoundedResponseBytes(
  response: Response,
  tooLargeMessage: string
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(tooLargeMessage);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The response is already rejected; cancellation is only resource cleanup.
      }
      throw new Error(tooLargeMessage);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
