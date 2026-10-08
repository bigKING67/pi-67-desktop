// The engine never reads Provider configuration files. Hosts inject a resolver
// that returns the selected Provider's endpoint from their own credential truth
// (Desktop: Pi's model registry). Credentials stay in memory for one request.
export interface ProviderEndpoint {
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string> | undefined;
  /** Human-readable credential origin for receipts and checks; never the secret. */
  source?: string | undefined;
}
export type ProviderCredentials = (signal?: AbortSignal) => Promise<ProviderEndpoint>;
export interface ResolvedEndpoint { baseUrl: string; apiKey: string; headers: Record<string, string>; source: string }

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_HEADERS = new Set(["authorization", "content-type", "content-length", "host"]);

export async function resolveEndpoint(credentials: ProviderCredentials | undefined, signal?: AbortSignal): Promise<ResolvedEndpoint> {
  if (!credentials) throw new Error("Provider credentials unavailable: no image Provider is configured");
  let endpoint: ProviderEndpoint;
  try { endpoint = await credentials(signal); }
  catch { throw new Error("Provider credentials unavailable"); }
  let url: URL;
  try { url = new URL(endpoint.baseUrl); } catch { throw new Error("Invalid configured provider URL"); }
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol) ||
      (url.protocol === "http:" && !LOOPBACK.has(url.hostname))) throw new Error("Provider URL requires HTTPS or loopback HTTP, without embedded credentials");
  if (typeof endpoint.apiKey !== "string" || !endpoint.apiKey.trim() || /[\r\n]/.test(endpoint.apiKey)) throw new Error("Missing or invalid Provider API key");
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(endpoint.headers ?? {})) {
    if (FORBIDDEN_HEADERS.has(name.toLowerCase()) || /[\r\n]/.test(name) || typeof value !== "string" || /[\r\n]/.test(value)) throw new Error("Invalid Provider header");
    headers[name] = value;
  }
  return { baseUrl: url.href.replace(/\/$/, ""), apiKey: endpoint.apiKey, headers, source: endpoint.source ?? "host-injected credentials" };
}

const RESPONSE_LIMIT = 30_000_000;

export async function responseJSON(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > RESPONSE_LIMIT) throw new Error("response_size_limit");
  if (!response.body) throw new Error("invalid_image_response");
  const chunks: Uint8Array[] = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > RESPONSE_LIMIT) { await response.body.cancel().catch(() => undefined); throw new Error("response_size_limit"); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

const USAGE_KEYS = new Set(["input_tokens", "output_tokens", "total_tokens", "input_tokens_details", "output_tokens_details", "text_tokens", "image_tokens", "cached_tokens"]);

// Only known numeric usage fields survive; anything else (including echoed secrets) is dropped.
export function numericUsage(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!USAGE_KEYS.has(key)) continue;
    if (Number.isSafeInteger(item) && (item as number) >= 0) result[key] = item;
    else if (item && typeof item === "object") { const nested = numericUsage(item, depth + 1); if (nested) result[key] = nested; }
  }
  return Object.keys(result).length ? result : null;
}
