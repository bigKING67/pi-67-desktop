import { Duplex } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { NATIVE_TEAM_MODEL_MAX_FRAME } from "@pi67/protocol";
import { attachNativeTeamModelChannel } from "./native-team-model-channel.js";

afterEach(() => { vi.useRealTimers(); });
function fixture() {
  const writes: Buffer[] = [];
  const channel = new Duplex({ read() {}, write(chunk: Buffer, _encoding, callback) { writes.push(chunk); callback(); } });
  const authorizeTeam = vi.fn(async () => { throw new Error("Synthetic denied authorization"); });
  const authorizeProject = vi.fn(async () => { throw new Error("Unexpected project authorization"); });
  const invoke = vi.fn(async () => ({ status: 200, body: Buffer.from("{}") }));
  const lifetime = new AbortController();
  const model = { baseUrl: "https://model.invalid/v1", id: "fixture" };
  const handle = attachNativeTeamModelChannel(channel, { gateway: { authorizeTeam, authorizeProject },
    scope: { userId: "user", teamId: "team", projectId: null }, models: { embedding: model, extraction: model },
    invoke, signal: lifetime.signal });
  const request = { type: "team-model-request", requestId: "a".repeat(32), purpose: "embedding",
    endpoint: model.baseUrl, model: model.id, body: Buffer.from('{"model":"fixture"}').toString("base64") };
  return { channel, authorizeTeam, invoke, handle, request, lifetime };
}
function frame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
it.each(["identity", "route", "body-model", "stream", "base64", "oversize", "pipeline", "utf8"])(
  "retires invalid native frames before authorization: %s", async (kind) => {
    const f = fixture();
    let packet = frame(f.request);
    if (kind === "identity") packet = frame({ ...f.request, teamId: "another-team" });
    if (kind === "route") packet = frame({ ...f.request, endpoint: "https://another.invalid" });
    if (kind === "body-model") packet = frame({ ...f.request, body: Buffer.from('{"model":"other"}').toString("base64") });
    if (kind === "stream") packet = frame({ ...f.request, body: Buffer.from('{"model":"fixture","stream":true}').toString("base64") });
    if (kind === "base64") packet = frame({ ...f.request, body: "AA=A" });
    if (kind === "oversize") { packet = Buffer.alloc(4); packet.writeUInt32BE(NATIVE_TEAM_MODEL_MAX_FRAME + 1); }
    if (kind === "pipeline") packet = Buffer.concat([packet, packet]);
    if (kind === "utf8") packet = Buffer.from([0, 0, 0, 1, 255]);
    try {
      f.channel.emit("data", packet);
      await Promise.resolve();
      expect(f.channel.destroyed).toBe(true);
      expect(f.authorizeTeam).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
    } finally { f.handle.stop(); }
  }
);
it("bounds fragmented frame assembly without extending the first-byte deadline", () => {
  vi.useFakeTimers(); const f = fixture();
  try {
    f.channel.emit("data", Buffer.from([0])); vi.advanceTimersByTime(4_000);
    f.channel.emit("data", Buffer.from([0])); vi.advanceTimersByTime(1_000);
    expect(f.channel.destroyed).toBe(true); expect(f.authorizeTeam).not.toHaveBeenCalled();
  } finally { f.handle.stop(); }
});
it("accepts fragmented valid frames but never invokes a denied model", async () => {
  const f = fixture(), packet = frame(f.request);
  try {
    f.channel.emit("data", packet.subarray(0, 2)); f.channel.emit("data", packet.subarray(2));
    await vi.waitFor(() => expect(f.channel.destroyed).toBe(true));
    expect(f.authorizeTeam).toHaveBeenCalledOnce(); expect(f.invoke).not.toHaveBeenCalled();
  } finally { f.handle.stop(); }
});
it("retires an idle channel on owner cancellation", () => {
  const f = fixture(); f.lifetime.abort();
  expect(f.channel.destroyed).toBe(true); expect(f.invoke).not.toHaveBeenCalled();
});
