import { Duplex } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { MAX_NATIVE_TEAM_QUERY_RESULT_BYTES } from "@pi67/protocol";

const native = vi.hoisted(() => ({ start: vi.fn(), CleanupError: class extends Error {} }));
vi.mock("./native-team-model-worker.mjs", () => ({ startNativeTeamModelWorker: native.start, NativeTeamWorkerCleanupError: native.CleanupError }));
afterEach(() => { native.start.mockReset(); vi.useRealTimers(); vi.restoreAllMocks(); });
const hit = { assetId: "00000000-0000-4000-8000-000000000001", score: 0.75 };
async function fixture() {
  vi.resetModules();
  const { runNativeTeamIndexQuery } = await import("./native-team-index-query.js");
  const writes: Buffer[] = [], channel = new Duplex({ read() {}, write(chunk: Buffer, _encoding, done) { writes.push(Buffer.from(chunk)); done(); } });
  const completion = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
  let signal!: AbortSignal, relay: { stop(): void } | undefined;
  native.start.mockImplementation(async (options, lifetime: AbortSignal) => {
    signal = lifetime; relay = options.attachModelChannel(channel);
    return { pid: 4242, completion: completion.promise, stop: async () => {} };
  });
  const caller = new AbortController();
  const input = { python: "/admitted/python", bootstrap: "/admitted/team_query_worker.py", directory: "/owned/query-test",
    request: { schema: "newmoney.team-vector-query.v1" as const, scopeKey: "a".repeat(64), assetIds: [hit.assetId], vector: [0, 1, 0, 0], limit: 4 },
    signal: caller.signal, assertLaunchable: vi.fn(async () => undefined) };
  const frame = (value: unknown) => {
    const body = Buffer.from(JSON.stringify(value)), bytes = Buffer.alloc(body.length + 4);
    bytes.writeUInt32BE(body.length); body.copy(bytes, 4); return bytes;
  };
  const result = () => frame({ schema: "newmoney.team-vector-result.v1", hits: [hit] });
  const exit = (code = 0) => { relay?.stop(); completion.resolve({ code, signal: null }); };
  return { run: () => runNativeTeamIndexQuery(input), input, writes, channel, completion, caller, frame, result, exit, signal: () => signal };
}
it("bounds and frames the request, ACKs a fragmented result but waits for physical completion", async () => {
  const f = await fixture(); const run = f.run(); let settled = false; void run.then(() => { settled = true; });
  await vi.waitFor(() => expect(f.writes).toHaveLength(1));
  const sent = f.writes[0]!; expect(sent.readUInt32BE()).toBe(sent.length - 4);
  expect(JSON.parse(sent.subarray(4).toString())).toEqual(f.input.request);
  const result = f.result(); f.channel.emit("data", result.subarray(0, 2)); f.channel.emit("data", result.subarray(2, 9)); f.channel.emit("data", result.subarray(9));
  expect(f.writes[1]).toEqual(Buffer.from([1])); await Promise.resolve(); expect(settled).toBe(false);
  f.exit(); expect(await run).toEqual([hit]);
});
it.each(["extra-frame", "oversized", "empty", "invalid-utf8", "duplicate", "body", "foreign-asset", "too-many", "nonzero-exit", "missing"])("rejects %s and never accepts a partial/unchecked result", async mode => {
  const f = await fixture(), run = f.run(), rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(f.writes).toHaveLength(1));
  if (mode === "oversized" || mode === "empty") {
    const header = Buffer.alloc(4); header.writeUInt32BE(mode === "empty" ? 0 : MAX_NATIVE_TEAM_QUERY_RESULT_BYTES + 1); f.channel.emit("data", header);
  } else if (mode === "invalid-utf8") f.channel.emit("data", Buffer.from([0, 0, 0, 1, 0xff]));
  else if (mode === "extra-frame") { f.channel.emit("data", f.result()); f.channel.emit("data", f.result()); }
  else if (mode === "foreign-asset") f.channel.emit("data", f.frame({ schema: "newmoney.team-vector-result.v1", hits: [{ ...hit, assetId: hit.assetId.slice(0, -1) + "2" }] }));
  else if (mode === "duplicate" || mode === "body" || mode === "too-many") {
    f.channel.emit("data", f.frame({ schema: "newmoney.team-vector-result.v1", hits: mode === "body" ? [{ ...hit, body: "forbidden" }]
      : mode === "duplicate" ? [hit, hit] : Array.from({ length: 5 }, (_, i) => ({ ...hit, assetId: hit.assetId.slice(0, -1) + String(i) })) }));
  } else if (mode === "nonzero-exit") f.channel.emit("data", f.result());
  if (mode !== "missing" && mode !== "nonzero-exit") expect(f.signal().aborted).toBe(true);
  f.exit(mode === "nonzero-exit" ? 70 : 0); await rejected;
});
it("does not settle cancellation until the process owner confirms exit", async () => {
  const f = await fixture(), run = f.run(); let settled = false; void run.catch(() => { settled = true; });
  await vi.waitFor(() => expect(f.writes).toHaveLength(1));
  f.caller.abort(); expect(f.signal().aborted).toBe(true); await Promise.resolve(); expect(settled).toBe(false);
  f.exit(); await expect(run).rejects.toThrow("unavailable");
});
it("propagates its 30-second deadline but waits for confirmed process exit", async () => {
  const f = await fixture(), deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const run = f.run(), rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(f.writes).toHaveLength(1));
  expect(timeout).toHaveBeenCalledWith(30_000); deadline.abort(); expect(f.signal().aborted).toBe(true);
  f.exit(); await rejected;
});
it.each(["invalid", "denied", "cancelled"])("rejects %s before spawning", async mode => {
  const f = await fixture();
  if (mode === "invalid") f.input.request.vector = [Infinity, 0, 0, 0];
  if (mode === "denied") f.input.assertLaunchable.mockRejectedValue(new Error("Sensitive denial"));
  if (mode === "cancelled") f.caller.abort();
  await expect(f.run()).rejects.toThrow("unavailable"); expect(native.start).not.toHaveBeenCalled();
});
it.each(["launch", "completion"])("retains uncertain %s and quarantines later launches", async mode => {
  const f = await fixture();
  if (mode === "launch") native.start.mockRejectedValueOnce(new native.CleanupError("uncertain"));
  const run = f.run(), rejected = expect(run).rejects.toThrow("retain its working copy");
  if (mode === "completion") {
    await vi.waitFor(() => expect(f.writes).toHaveLength(1)); f.completion.reject(new native.CleanupError("uncertain"));
  }
  await rejected;
  await expect(f.run()).rejects.toThrow("unavailable"); expect(native.start).toHaveBeenCalledTimes(1);
});
