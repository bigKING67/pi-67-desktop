import type { Duplex } from "node:stream";
import { isNativeTeamQuery, isNativeTeamQueryResult, MAX_NATIVE_TEAM_QUERY_BYTES,
  MAX_NATIVE_TEAM_QUERY_RESULT_BYTES, type NativeTeamQuery, type NativeTeamQueryResult } from "@pi67/protocol";
import { NativeTeamWorkerCleanupError, startNativeTeamModelWorker } from "./native-team-model-worker.mjs";
import { TeamIndexWorkingCopyRetentionError } from "./team-index-artifact.js";

let quarantined = false;
const unavailable = () => new Error("Native team vector query is unavailable.");

/** Main supplies an independently admitted, exact query bootstrap and copied cwd.
 * This low-level owner neither admits a runtime nor embeds user text. No fallback
 * to an index/private/probe bootstrap is allowed by its Main caller. */
export async function runNativeTeamIndexQuery(input: {
  python: string; bootstrap: string; directory: string; request: NativeTeamQuery; signal: AbortSignal;
  assertLaunchable(this: void, signal: AbortSignal): Promise<void>;
}) {
  if (quarantined || !isNativeTeamQuery(input.request)) throw unavailable();
  const request = structuredClone(input.request), body = Buffer.from(JSON.stringify(request));
  const assets = new Set(request.assetIds);
  if (body.length > MAX_NATIVE_TEAM_QUERY_BYTES) throw unavailable();
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal, AbortSignal.timeout(30_000)]);
  let result: NativeTeamQueryResult | undefined;
  let invalid = false;
  const fail = () => { invalid = true; controller.abort(); };
  const attachModelChannel = (channel: Duplex) => {
    const buffer = Buffer.alloc(MAX_NATIVE_TEAM_QUERY_RESULT_BYTES + 4);
    let used = 0, size: number | undefined;
    const data = (chunk: Buffer) => {
      if (invalid || result || chunk.length > buffer.length - used) { fail(); return; }
      chunk.copy(buffer, used); used += chunk.length;
      if (used >= 4 && size === undefined) {
        size = buffer.readUInt32BE(0);
        if (size === 0 || size > MAX_NATIVE_TEAM_QUERY_RESULT_BYTES) { fail(); return; }
      }
      if (size === undefined || used < size + 4) return;
      if (used !== size + 4) { fail(); return; }
      try {
        const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(4, used)));
        if (!isNativeTeamQueryResult(value) || value.hits.length > request.limit || value.hits.some(hit => !assets.has(hit.assetId))) throw unavailable();
        result = value;
        // Child cannot exit normally before Main has received the complete frame.
        channel.write(Buffer.from([1]), error => { if (error) fail(); });
      } catch { fail(); }
    };
    channel.on("data", data); channel.on("error", fail);
    const frame = Buffer.alloc(body.length + 4); frame.writeUInt32BE(body.length); body.copy(frame, 4);
    channel.write(frame, error => { if (error) fail(); });
    return { stop() { channel.removeListener("data", data); channel.removeListener("error", fail); } };
  };
  try {
    signal.throwIfAborted(); await input.assertLaunchable(signal); signal.throwIfAborted();
    if (quarantined) throw unavailable();
    const worker = await startNativeTeamModelWorker({ python: input.python, bootstrap: input.bootstrap,
      cwd: input.directory, arguments: [], attachModelChannel }, signal);
    // No Promise.race here: cancellation must await the existing group owner.
    const exit = await worker.completion;
    signal.throwIfAborted();
    if (invalid || exit.code !== 0 || exit.signal !== null || !result) throw unavailable();
    return result.hits;
  } catch (error) {
    if (error instanceof NativeTeamWorkerCleanupError) {
      quarantined = true;
      throw new TeamIndexWorkingCopyRetentionError();
    }
    throw unavailable();
  }
}
