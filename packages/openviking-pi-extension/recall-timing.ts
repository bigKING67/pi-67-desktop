/** Optional server-reported durations; stages may overlap and are not additive. */
export interface ContextServerTiming {
  durationMs: number;
  targetAbstractMs?: number;
  intentAnalysisMs?: number;
  embedQueryMs?: number;
  vectorRetrievalMs?: number;
}

/** Only the managed context request opts into the existing summary response. */
export function withContextTiming(init: RequestInit | undefined): RequestInit | undefined {
  if (init?.method !== "POST" || typeof init.body !== "string") return init;
  try {
    const body: unknown = JSON.parse(init.body);
    if (!record(body) || body.mode !== "context") return init;
    return { ...init, body: JSON.stringify({ ...body, telemetry: { summary: true } }) };
  } catch { return init; }
}

/** A network boundary: never retain the raw summary, IDs, errors or token data. */
export function readContextServerTiming(value: unknown): ContextServerTiming | undefined {
  if (!record(value) || !record(value.summary)) return undefined;
  const summary = value.summary;
  if (summary.operation !== "search.context" || summary.status !== "ok") return undefined;
  const durationMs = duration(summary.duration_ms);
  if (durationMs === undefined) return undefined;
  const result: ContextServerTiming = { durationMs };
  const search = summary.search;
  if (record(search)) {
    for (const [source, target] of [
      ["target_abstract", "targetAbstractMs"], ["intent_analysis", "intentAnalysisMs"],
      ["embed_query", "embedQueryMs"], ["vector_retrieval", "vectorRetrievalMs"],
    ] as const) {
      const stage = search[source];
      const ms = record(stage) ? duration(stage.duration_ms) : undefined;
      if (ms !== undefined) result[target] = ms;
    }
  }
  return result;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function duration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 600_000
    ? Math.round(value) : undefined;
}
