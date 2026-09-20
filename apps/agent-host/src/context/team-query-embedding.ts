import type { TeamIndexSettings } from "@pi67/protocol";
import { createTeamEmbeddingTransport } from "./team-index-model-transport.js";
import { runSharedMemoryModelRequest } from "./shared-memory-model-request.js";

export type TeamQueryModel = { endpoint: string; model: string; dimension: number };
const unavailable = () => new Error("Team query embedding unavailable.");

/** User text only, not a prompt/session/body bundle. Preserve exact Unicode. */
export function assertTeamQueryText(query: string): void {
  if (typeof query !== "string" || !query.trim() || query.length > 8192
      || Buffer.byteLength(query, "utf8") > 8192 || Buffer.from(query).toString("utf8") !== query) throw unavailable();
}

/** Host-only, credential-free metadata plus a captured embedding-only closure.
 * Query processing is not read authority. The search owner must still prove its
 * current index/receipt/scope and revalidate before using any result.
 */
export function createTeamQueryEmbedding(input: TeamIndexSettings["embedding"], lifetime: AbortSignal) {
  const settings = { ...input };
  if (!Number.isSafeInteger(settings.dimension) || settings.dimension < 4 || settings.dimension > 4096 || settings.dimension % 4) throw unavailable();
  const model = Object.freeze({ endpoint: settings.endpoint, model: settings.model, dimension: settings.dimension });
  const invoke = createTeamEmbeddingTransport(settings, lifetime);
  return Object.freeze({ model, async embed(query: string,
    gateway: Parameters<typeof runSharedMemoryModelRequest>[0],
    scope: { userId: string; teamId: string; projectId: string | null }, caller: AbortSignal) {
    let pending: ReturnType<typeof invoke> | undefined;
    let resultVector: readonly number[];
    const signal = AbortSignal.any([lifetime, caller]);
    try {
      signal.throwIfAborted(); assertTeamQueryText(query);
      const body = Buffer.from(JSON.stringify({ model: settings.model, input: [query], encoding_format: "float" }));
      const vector = await runSharedMemoryModelRequest(gateway, { ...scope, purpose: "embedding",
        model: { baseUrl: settings.endpoint, id: settings.model } }, async (selected, requestSignal) => {
        pending = invoke("embedding", selected, body, requestSignal);
        const response = await pending;
        requestSignal.throwIfAborted();
        if (response.status !== 200) throw unavailable();
        const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body));
        if (!result || typeof result !== "object" || !("model" in result) || result.model !== settings.model
            || !("data" in result) || !Array.isArray(result.data) || result.data.length !== 1) throw unavailable();
        const row: unknown = result.data[0];
        if (!row || typeof row !== "object" || !("index" in row) || row.index !== 0
            || !("embedding" in row) || !Array.isArray(row.embedding) || row.embedding.length !== settings.dimension
            || !row.embedding.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 3.4028234663852886e38)) throw unavailable();
        requestSignal.throwIfAborted();
        return Object.freeze(row.embedding.slice() as number[]);
      }, signal);
      signal.throwIfAborted(); resultVector = vector;
    } catch { throw unavailable(); }
    finally {
      // Caller cancellation is not transport completion. Do not free the owner's
      // bounded slot while a non-cooperative fetch/stream is still outstanding.
      await pending?.catch(() => undefined);
    }
    if (signal.aborted) throw unavailable();
    return resultVector;
  } });
}

export type TeamQueryEmbedding = ReturnType<typeof createTeamQueryEmbedding>;
