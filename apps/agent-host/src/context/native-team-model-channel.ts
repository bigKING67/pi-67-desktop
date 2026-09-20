import type { Duplex } from "node:stream";
import { isNativeTeamModelRequest, NATIVE_TEAM_MODEL_MAX_BODY, NATIVE_TEAM_MODEL_MAX_FRAME, type NativeTeamModelRequest } from "@pi67/protocol";
import { runSharedMemoryModelRequest } from "./shared-memory-model-request.js";

type Gateway = Parameters<typeof runSharedMemoryModelRequest>[0];
type Model = { baseUrl: string; id: string };

/** Dedicated worker channel only. No Renderer route, listener, provider catalog
 * or native-supplied identity. Close invalidates all work; never reuse the worker.
 * Owner must supply a lifetime signal and an exact provider transport honoring it.
 */
export function attachNativeTeamModelChannel(channel: Duplex, options: {
  gateway: Gateway;
  scope: { userId: string; teamId: string; projectId: string | null };
  models: { embedding: Model; extraction: Model };
  invoke(purpose: "embedding" | "extraction", model: Readonly<Model>, body: Uint8Array, signal: AbortSignal): Promise<{ status: number; body: Uint8Array }>;
  signal: AbortSignal;
}) {
  const scope = { ...options.scope };
  const models = { embedding: Object.freeze({ ...options.models.embedding }), extraction: Object.freeze({ ...options.models.extraction }) };
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, lifetime.signal]);
  let buffer = Buffer.alloc(0), active = false, stopped = false;
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  const clearFrameTimer = () => { clearTimeout(frameTimer); frameTimer = undefined; };
  const stop = () => {
    if (stopped) return;
    stopped = true; lifetime.abort(); buffer = Buffer.alloc(0);
    clearFrameTimer();
    channel.removeListener("data", receive); signal.removeEventListener("abort", stop);
    channel.destroy();
  };
  const send = (value: object) => {
    if (signal.aborted || stopped) return;
    const data = Buffer.from(JSON.stringify(value));
    if (data.length > NATIVE_TEAM_MODEL_MAX_FRAME) { stop(); return; }
    const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
    channel.write(Buffer.concat([header, data]), (error) => { if (error) stop(); });
  };
  const process = async (request: NativeTeamModelRequest) => {
    try {
      const selected = models[request.purpose];
      const body = Buffer.from(request.body, "base64");
      if (request.endpoint !== selected.baseUrl || request.model !== selected.id || body.length > NATIVE_TEAM_MODEL_MAX_BODY
          || body.toString("base64") !== request.body) throw new Error("Invalid native model route.");
      const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      if (!payload || typeof payload !== "object" || !("model" in payload) || payload.model !== selected.id
          || "stream" in payload && payload.stream === true) throw new Error("Invalid native model body.");
      const response = await runSharedMemoryModelRequest(options.gateway, { ...scope, purpose: request.purpose, model: selected },
        (model, requestSignal) => options.invoke(request.purpose, model, body, requestSignal), signal);
      if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599
          || response.status >= 300 && response.status < 400 || response.body.byteLength > NATIVE_TEAM_MODEL_MAX_BODY) {
        throw new Error("Invalid native model response.");
      }
      // Never return provider error text, credentials or response headers to OV.
      send({ type: "team-model-result", requestId: request.requestId, ok: true, status: response.status,
        body: Buffer.from(response.status >= 400 ? new TextEncoder().encode('{"error":{"message":"Team model request failed"}}') : response.body).toString("base64") });
    } catch {
      send({ type: "team-model-result", requestId: request.requestId, ok: false });
      stop(); // Denial/malformed requests cannot retry through an obsolete channel.
    } finally { active = false; }
  };
  function receive(chunk: Buffer) {
    if (stopped) return;
    if (active || buffer.length + chunk.length > NATIVE_TEAM_MODEL_MAX_FRAME + 4) { stop(); return; }
    // Fixed assembly deadline from the first byte; slow fragments cannot renew it.
    if (chunk.length && !frameTimer) frameTimer = setTimeout(stop, 5_000);
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length < 4) return;
    const length = buffer.readUInt32BE(0);
    if (length === 0 || length > NATIVE_TEAM_MODEL_MAX_FRAME) { stop(); return; }
    if (buffer.length < length + 4) return;
    // Single-flight wire contract; pipelined or trailing bytes are not accepted.
    if (buffer.length !== length + 4) { stop(); return; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(4))); }
    catch { stop(); return; }
    buffer = Buffer.alloc(0);
    clearFrameTimer();
    if (!isNativeTeamModelRequest(value)) { stop(); return; }
    active = true; void process(value);
  }
  channel.on("data", receive); channel.on("error", stop); channel.on("end", stop); channel.on("close", stop);
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  return { stop };
}
