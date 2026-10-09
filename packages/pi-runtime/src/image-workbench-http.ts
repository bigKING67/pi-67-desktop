// Transport rules shared by the image APIs Desktop registers with Pi
// (`openai-images`, `ark-images`): HTTPS or loopback endpoints only, bounded
// bodies, and image bytes taken either inline (base64) or from a returned URL.

const RESPONSE_LIMIT = 30_000_000;
const MAX_REDIRECTS = 3;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isBase64 = (value: string): boolean => value.length > 0 && value.length % 4 === 0 && BASE64.test(value);

function allowedUrl(value: string): URL | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol) || (url.protocol === "http:" && !LOOPBACK.has(url.hostname))) return undefined;
  return url;
}

export function endpointUrl(baseUrl: string, endpoint: string): string {
  const url = allowedUrl(baseUrl);
  if (!url || url.search || url.hash) throw new Error("invalid_endpoint");
  return `${url.href.replace(/\/$/, "")}/${endpoint}`;
}

async function boundedBytes(response: Response): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > RESPONSE_LIMIT) throw new Error("response_size_limit");
  if (!response.body) throw new Error("invalid_image_response");
  const chunks: Uint8Array[] = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > RESPONSE_LIMIT) { await response.body.cancel().catch(() => undefined); throw new Error("response_size_limit"); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function responseJSON(response: Response): Promise<unknown> {
  const bytes = await boundedBytes(response);
  try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { throw new Error("invalid_image_response"); }
}

/** PNG, JPEG or WebP by signature; anything else is not an image this engine accepts. */
export function imageMimeType(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return undefined;
}

/**
 * Downloads an image a gateway returned by URL. The Provider key is never sent
 * to it, and every redirect hop must pass the same endpoint policy.
 */
export async function downloadImage(location: string, fetchImpl: typeof fetch, signal: AbortSignal | undefined): Promise<{ mimeType: string; data: string }> {
  let current = location;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = allowedUrl(current);
    if (!url) throw new Error("invalid_image_response");
    const response = await fetchImpl(url.href, { method: "GET", redirect: "manual", ...(signal ? { signal } : {}) });
    const next = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && next) {
      await response.body?.cancel();
      current = new URL(next, url).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error("invalid_image_response"); }
    const bytes = await boundedBytes(response);
    const mimeType = imageMimeType(bytes);
    if (!mimeType) throw new Error("invalid_image_response");
    return { mimeType, data: bytes.toString("base64") };
  }
  throw new Error("invalid_image_response");
}

/** `data[]` rows carrying `b64_json` or `url`, decoded into Pi image content. */
export async function responseImages(rows: unknown, fetchImpl: typeof fetch, signal: AbortSignal | undefined): Promise<{ type: "image"; mimeType: string; data: string }[]> {
  if (!Array.isArray(rows) || !rows.length) throw new Error("invalid_image_response");
  const images: { type: "image"; mimeType: string; data: string }[] = [];
  for (const row of rows) {
    const encoded = isRecord(row) ? row.b64_json : undefined;
    const location = isRecord(row) ? row.url : undefined;
    if (typeof encoded === "string") {
      if (!isBase64(encoded)) throw new Error("invalid_image_response");
      images.push({ type: "image", mimeType: imageMimeType(Buffer.from(encoded.slice(0, 64), "base64")) ?? "image/png", data: encoded });
    } else if (typeof location === "string") {
      images.push({ type: "image", ...await downloadImage(location, fetchImpl, signal) });
    } else throw new Error("invalid_image_response");
  }
  return images;
}

/**
 * The parameter a gateway named when it rejected a request (for example
 * `quality` when it only allows `low`), as a bounded token. The response text
 * itself is never kept, so a gateway echoing the key cannot leak it.
 */
export async function rejectedParameter(response: Response): Promise<string | undefined> {
  try {
    const data = await responseJSON(response);
    const error = isRecord(data) && isRecord(data.error) ? data.error : undefined;
    const value = error?.param;
    return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.[\]]{0,47}$/u.test(value) ? value : undefined;
  } catch { return undefined; }
}
