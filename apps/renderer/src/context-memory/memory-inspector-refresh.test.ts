import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import type { ConnectionSubscriber } from "../connection/agent-connection-controller-contract.js";
const f = vi.hoisted(() => ({ subscriber: undefined as ConnectionSubscriber | undefined, unsubscribe: vi.fn() }));
vi.mock("../connection/AgentConnectionController.js", () => ({ agentConnectionController: {
  subscribe: (subscriber: ConnectionSubscriber) => { f.subscriber = subscriber; return f.unsubscribe; },
} }));
import { watchMemoryInspector } from "./memory-inspector-refresh.js";
const scope = { workspaceId: "workspace", sessionId: "session", sessionGeneration: 2 };
function settled(overrides = {}, reason = "settled") {
  f.subscriber?.onEvent?.({ type: "conversation.changed", payload: { sessionId: "session", reason } } as AgentEvent,
    { context: { scope: "task", ...scope, ...overrides } } as EventEnvelope);
}
function committed(sessionId = "session", workspaceId = "workspace") {
  f.subscriber?.onEvent?.({ type: "context.commitCompleted", payload: { sessionId, operationId: "operation" } },
    { context: { scope: "workspace", workspaceId } } as EventEnvelope);
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.clearAllMocks());

describe("memory inspector refresh boundaries", () => {
  it("refreshes on settled turns and archive results, not streaming or other scopes", async () => {
    const refresh = vi.fn(async () => undefined);
    const stop = watchMemoryInspector(scope, refresh, vi.fn());
    await tick();
    settled({ sessionId: "other" }); settled({ workspaceId: "other" }); settled({ sessionGeneration: 1 });
    settled({}, "user-appended"); committed("other"); committed("session", "other");
    await tick(); expect(refresh).toHaveBeenCalledTimes(1);
    settled(); await tick(); committed(); await tick();
    expect(refresh).toHaveBeenCalledTimes(3);
    stop(); expect(f.unsubscribe).toHaveBeenCalledOnce();
  });

  it("coalesces boundaries during a read and discards its stale result", async () => {
    const published: number[] = [];
    let release!: () => void;
    let calls = 0;
    const refresh = vi.fn(async (isCurrent: () => boolean) => {
      calls++;
      if (calls === 1) await new Promise<void>((resolve) => { release = resolve; });
      if (isCurrent()) published.push(calls);
    });
    const stop = watchMemoryInspector(scope, refresh, vi.fn());
    settled(); committed(); settled();
    expect(refresh).toHaveBeenCalledOnce();
    release(); await tick();
    expect(refresh).toHaveBeenCalledTimes(2); expect(published).toEqual([2]);
    stop();
  });

  it("withholds reads after disconnect, refreshes on recovery, and ignores results after disposal", async () => {
    const guards: Array<() => boolean> = [];
    const unavailable = vi.fn();
    const stop = watchMemoryInspector(scope, async (isCurrent) => { guards.push(isCurrent); }, unavailable);
    await tick();
    f.subscriber?.onTeardown?.(new Error("closed"));
    expect(guards[0]!()).toBe(false); expect(unavailable).toHaveBeenCalledOnce();
    committed(); await tick(); expect(guards).toHaveLength(1);
    f.subscriber?.onConnected?.({} as Parameters<NonNullable<ConnectionSubscriber["onConnected"]>>[0]);
    await tick(); expect(guards).toHaveLength(2); expect(guards[1]!()).toBe(true);
    stop(); expect(guards[1]!()).toBe(false);
    f.subscriber?.onTeardown?.(new Error("late")); committed(); await tick();
    expect(unavailable).toHaveBeenCalledOnce(); expect(guards).toHaveLength(2);
  });

  it("reports failed reads as unavailable and allows a later boundary to recover", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
    const unavailable = vi.fn();
    const stop = watchMemoryInspector(scope, refresh, unavailable);
    await tick(); expect(unavailable).toHaveBeenCalledOnce();
    settled(); await tick(); expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("invalidates a pending read on a sequence gap and coalesces recovery", async () => {
    let release!: () => void;
    let oldIsCurrent!: () => boolean;
    const refresh = vi.fn(async (isCurrent: () => boolean) => {
      if (refresh.mock.calls.length === 1) {
        oldIsCurrent = isCurrent;
        await new Promise<void>((resolve) => { release = resolve; });
      }
    });
    const unavailable = vi.fn();
    const stop = watchMemoryInspector(scope, refresh, unavailable);
    f.subscriber?.onSequenceGap?.({} as Parameters<NonNullable<ConnectionSubscriber["onSequenceGap"]>>[0]);
    expect(oldIsCurrent()).toBe(false); expect(unavailable).toHaveBeenCalledOnce();
    release(); await tick(); expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });
});
