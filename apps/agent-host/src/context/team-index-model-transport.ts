import { NATIVE_TEAM_MODEL_MAX_BODY } from "@pi67/protocol";
import type { LocalMemoryExtractionModel } from "@pi67/pi-runtime";
import type { attachNativeTeamModelChannel } from "./native-team-model-channel.js";

type Invoke = Parameters<typeof attachNativeTeamModelChannel>[1]["invoke"];
const unavailable = () => new Error("Team model request unavailable.");
const failureBody = new TextEncoder().encode('{"error":{"message":"Team model request failed"}}');

/** Validate the narrower team-job route without narrowing private-memory settings.
 * This is a credential boundary; never include input values in errors. */
export function assertTeamIndexModel(model: LocalMemoryExtractionModel): void {
  try {
    const url = new URL(model.endpoint);
    if (model.protocol !== "openai-compatible" || model.endpoint.length > 2048
      || /[\s\p{Cc}\\?#]/u.test(model.endpoint) || url.protocol !== "https:" || url.username || url.password
      || !model.model.length || model.model.length > 128 || /[\s\p{Cc}]/u.test(model.model)
      || !model.apiKey.length || model.apiKey.length > 4096 || /[^\x21-\x7e]/u.test(model.apiKey)) throw unavailable();
  } catch { throw unavailable(); }
}

/** Host-only OpenViking memory transport, not a Pi Provider adapter. Credentials
 * stay in this closure. Native supplies neither destination paths nor headers.
 * Call only inside the per-frame enterprise model guard. No retries or fallback. */
export function createTeamIndexModelTransport(
  input: { embedding: LocalMemoryExtractionModel; extraction: LocalMemoryExtractionModel },
  lifetime: AbortSignal
): Invoke {
  const credentials = { embedding: { ...input.embedding }, extraction: { ...input.extraction } };
  assertTeamIndexModel(credentials.embedding); assertTeamIndexModel(credentials.extraction);
  return createTransport(credentials, lifetime);
}

/** Query-only memory transport: no extraction credential is resolved or retained. */
export function createTeamEmbeddingTransport(input: LocalMemoryExtractionModel, lifetime: AbortSignal): Invoke {
  const embedding = { ...input };
  assertTeamIndexModel(embedding);
  return createTransport({ embedding }, lifetime);
}

function createTransport(credentials: { embedding: LocalMemoryExtractionModel; extraction?: LocalMemoryExtractionModel }, lifetime: AbortSignal): Invoke {
  return async (purpose, model, body, requestSignal) => {
    const signal = AbortSignal.any([lifetime, requestSignal]);
    let response: Response | undefined;
    try {
      signal.throwIfAborted();
      const selected = credentials[purpose];
      if (!selected || model.baseUrl !== selected.endpoint || model.id !== selected.model
        || body.byteLength > NATIVE_TEAM_MODEL_MAX_BODY) throw unavailable();
      const url = new URL(`${selected.endpoint.replace(/\/+$/u, "")}/${purpose === "embedding" ? "embeddings" : "chat/completions"}`).href;
      response = await fetch(url, { method: "POST", redirect: "error", credentials: "omit",
        referrerPolicy: "no-referrer", cache: "no-store", signal,
        headers: { Authorization: `Bearer ${selected.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: Uint8Array.from(body) });
      signal.throwIfAborted();
      if (response.redirected || response.url && response.url !== url
        || response.status < 200 || response.status >= 300 && response.status < 400 || response.status > 599) throw unavailable();
      if (response.status >= 400) {
        void response.body?.cancel().catch(() => undefined);
        return { status: response.status, body: failureBody.slice() };
      }
      if (!response.body || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw unavailable();
      return { status: response.status, body: await readBody(response.body, signal) };
    } catch {
      void response?.body?.cancel().catch(() => undefined);
      // Fetch, TLS, stream and cancellation errors may include URLs/headers/body.
      throw unavailable();
    }
  };
}

async function readBody(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const bytes = new Uint8Array(NATIVE_TEAM_MODEL_MAX_BODY);
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) return bytes.slice(0, size);
      if (chunk.value.byteLength > bytes.length - size) throw unavailable();
      bytes.set(chunk.value, size); size += chunk.value.byteLength;
    }
  } catch { cancel(); throw unavailable(); }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
