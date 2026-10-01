import type { TeamChatConnectionState, TeamChatPushEvent } from "@pi67/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostCommandError } from "../protocol-error.js";
import { parseFrame, TeamChatRealtime, teamChatRealtimeUrl, type TeamChatSocket } from "./team-chat-realtime.js";

class FakeSocket implements TeamChatSocket {
  onmessage: TeamChatSocket["onmessage"] = null;
  onclose: TeamChatSocket["onclose"] = null;
  onerror: TeamChatSocket["onerror"] = null;
  closedWith: number | undefined;
  constructor(readonly url: string) {}
  close(code?: number): void { this.closedWith = code ?? 1000; }
  frame(value: unknown): void { this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) }); }
  drop(code = 1006): void { this.onclose?.({ code }); }
}

const message = {
  id: "m1", conversationId: "c1", seq: 1, senderUserId: "u2", body: "你好",
  clientKey: "client-key-1", createdAt: "2026-10-01T00:00:00Z"
};

function harness() {
  const sockets: FakeSocket[] = [];
  const states: TeamChatConnectionState[] = [];
  const pushes: TeamChatPushEvent[] = [];
  const credential = { present: true, lifetime: new AbortController() };
  const resolveUrl = vi.fn(async (_signal: AbortSignal) => "wss://chat.example.test/realtime?ticket=t");
  const realtime = new TeamChatRealtime({
    resolveUrl,
    hasCredential: () => credential.present,
    credentialSignal: () => credential.lifetime.signal,
    onState: (state) => states.push(state),
    onPush: (event) => pushes.push(event),
    openSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    heartbeatTimeoutMs: 60_000,
    random: () => 0
  });
  const replaceCredential = (present: boolean) => {
    credential.present = present;
    const retired = credential.lifetime;
    credential.lifetime = new AbortController();
    retired.abort();
  };
  return { realtime, sockets, states, pushes, resolveUrl, replaceCredential, last: () => sockets.at(-1)! };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe("TeamChatRealtime", () => {
  it("goes live on ready, forwards pushes and ignores control or unknown frames", async () => {
    const { realtime, states, pushes, last } = harness();
    realtime.start();
    realtime.start();
    await flush();
    expect(states).toEqual([{ status: "connecting" }]);
    last().frame({ type: "message.created", message });
    expect(pushes).toEqual([]);
    last().frame({ type: "ready", serverTime: "2026-10-01T00:00:00Z" });
    last().frame({ type: "heartbeat" });
    last().frame({ type: "typing.started" });
    last().frame({ type: "message.created", conversationId: "c1", message });
    last().frame({ type: "read.changed", conversationId: "c1", lastReadSeq: 4 });
    last().frame({ type: "conversation.changed", conversationId: "c2" });
    last().frame({ type: "work_card.changed", conversationId: "c1", card: {
      id: "w1", conversationId: "c1", createdBy: "u1", assigneeUserId: null, claimedBy: null, title: "t", goal: "", acceptance: "",
      summary: "", refs: [], status: "todo", revision: 1, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" } });
    expect(states.at(-1)).toEqual({ status: "live", generation: 1 });
    expect(pushes).toEqual([
      { type: "message.created", message: { ...message, createdAt: Date.parse(message.createdAt) } },
      { type: "read.changed", conversationId: "c1", lastReadSeq: 4 },
      { type: "conversation.changed", conversationId: "c2" },
      { type: "work_card.changed", card: expect.objectContaining({ id: "w1", status: "todo", revision: 1 }) }
    ]);
    realtime.stop();
  });

  it("backs off after a drop and reconnects with a new generation", async () => {
    const { realtime, sockets, states, last } = harness();
    realtime.start();
    await flush();
    last().frame({ type: "ready" });
    last().drop();
    await flush();
    expect(states.at(-1)).toEqual({ status: "reconnecting", retryAt: 1_000_000 + 500 });
    await vi.advanceTimersByTimeAsync(499);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
    last().frame({ type: "ready" });
    expect(states.at(-1)).toEqual({ status: "live", generation: 2 });
    realtime.stop();
  });

  it("grows the backoff for repeated failures before going live", async () => {
    const { realtime, states, resolveUrl } = harness();
    resolveUrl.mockRejectedValue(new Error("offline"));
    realtime.start();
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(states.filter((state) => state.status === "reconnecting").map((state) => state.status === "reconnecting" && state.retryAt - 1_000_000))
      .toEqual([500, 1_500, 3_500]); // delays 500, 1000, 2000 ms
    realtime.stop();
  });

  it("reconnects immediately when the access token expires", async () => {
    const { realtime, sockets, states, last } = harness();
    realtime.start();
    await flush();
    last().frame({ type: "ready" });
    last().drop(4001);
    await flush();
    expect(sockets).toHaveLength(2);
    expect(states.some((state) => state.status === "reconnecting")).toBe(false);
    realtime.stop();
  });

  it("reports an unavailable team until the credential changes", async () => {
    const { realtime, states, resolveUrl, replaceCredential, sockets } = harness();
    resolveUrl.mockRejectedValueOnce(new HostCommandError("INVALID_PAYLOAD", "inactive", true, { serviceError: "entitlement_inactive" }));
    resolveUrl.mockRejectedValueOnce(new HostCommandError("INVALID_PAYLOAD", "gone", true, { serviceError: "team_not_found" }));
    realtime.start();
    await flush();
    expect(states.at(-1)).toEqual({ status: "unavailable", reason: "entitlement-inactive" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(resolveUrl).toHaveBeenCalledTimes(1);
    replaceCredential(true);
    await flush();
    expect(states.at(-1)).toEqual({ status: "unavailable", reason: "not-member" });
    replaceCredential(true);
    await flush();
    expect(sockets).toHaveLength(1);
    realtime.stop();
  });

  it("stops reconnecting after a service refusal but keeps backing off on transport failures", async () => {
    const { realtime, states, resolveUrl, replaceCredential } = harness();
    resolveUrl.mockRejectedValueOnce(new HostCommandError("RUNTIME_NOT_READY", "New Money sign-in expired or was rejected.", false));
    realtime.start();
    await flush();
    expect(states.at(-1)).toEqual({ status: "unavailable", reason: "rejected" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(resolveUrl).toHaveBeenCalledTimes(1);
    resolveUrl.mockRejectedValueOnce(new HostCommandError("RUNTIME_NOT_READY", "Sign in to New Money first.", true));
    replaceCredential(true);
    await flush();
    expect(states.at(-1)).toMatchObject({ status: "reconnecting" });
    realtime.stop();
  });

  it("closes the socket and waits while signed out", async () => {
    const { realtime, states, sockets, replaceCredential, last } = harness();
    realtime.start();
    await flush();
    last().frame({ type: "ready" });
    replaceCredential(false);
    await flush();
    expect(sockets[0]!.closedWith).toBe(1000);
    expect(states.at(-1)).toEqual({ status: "signed-out" });
    await vi.advanceTimersByTimeAsync(1_000);
    replaceCredential(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    realtime.stop();
  });

  it("treats silence and malformed frames as a dropped connection", async () => {
    const { realtime, states, sockets, last } = harness();
    realtime.start();
    await flush();
    last().frame({ type: "ready" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toMatchObject({ status: "reconnecting" });
    await vi.advanceTimersByTimeAsync(500);
    last().frame({ type: "ready" });
    last().frame("not json");
    await flush();
    expect(sockets[1]!.closedWith).toBe(1000);
    expect(states.at(-1)).toMatchObject({ status: "reconnecting" });
    realtime.stop();
  });

  it("stops without further state and closes the live socket", async () => {
    const { realtime, states, last } = harness();
    realtime.start();
    await flush();
    last().frame({ type: "ready" });
    const count = states.length;
    realtime.stop();
    await flush();
    expect(last().closedWith).toBe(1000);
    expect(states).toHaveLength(count);
    realtime.start();
    await flush();
    expect(states).toHaveLength(count);
  });

  it("starts signed out without connecting", async () => {
    const { realtime, resolveUrl, replaceCredential, states } = harness();
    replaceCredential(false);
    realtime.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolveUrl).not.toHaveBeenCalled();
    expect(realtime.state).toEqual({ status: "signed-out" });
    expect(states).toEqual([]);
    realtime.stop();
  });
});

describe("Team Chat realtime helpers", () => {
  it("upgrades HTTPS origins and permits plain sockets only on loopback", () => {
    expect(teamChatRealtimeUrl("https://newmoney.example.test/", "team 1", "a+b"))
      .toBe("wss://newmoney.example.test/v1/agent/teams/team%201/chat/realtime?ticket=a%2Bb");
    expect(teamChatRealtimeUrl("http://127.0.0.1:8787", "t", "k")).toBe("ws://127.0.0.1:8787/v1/agent/teams/t/chat/realtime?ticket=k");
    expect(() => teamChatRealtimeUrl("http://newmoney.example.test", "t", "k")).toThrow(HostCommandError);
  });

  it("rejects oversized, non-text and malformed frames", () => {
    expect(parseFrame(new ArrayBuffer(4))).toBeUndefined();
    expect(parseFrame("x".repeat(64 * 1024 + 1))).toBeUndefined();
    expect(parseFrame("[]")).toBeUndefined();
    expect(parseFrame(JSON.stringify({ type: 7 }))).toBeUndefined();
    expect(parseFrame(JSON.stringify({ type: "message.created", message: { ...message, seq: 0 } }))).toBeUndefined();
    expect(parseFrame(JSON.stringify({ type: "read.changed", conversationId: "c1", lastReadSeq: -1 }))).toBeUndefined();
    expect(parseFrame(JSON.stringify({ type: "policy.changed" }))).toEqual({ type: "policy.changed" });
  });
});
