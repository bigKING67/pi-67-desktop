import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { RuntimeResponseTimings } from "./runtime-response-timing.js";

const delta = (type: "text_delta" | "thinking_delta", content: string): AgentSessionEvent => ({
  type: "message_update", assistantMessageEvent: { type, delta: content }
} as AgentSessionEvent);

describe("content-free runtime response timing", () => {
  it("separates preparation, thinking, text and actual batch emission; ignores empty/early deltas", () => {
    let now = 100;
    const timings = new RuntimeResponseTimings(() => now);
    const flight = timings.begin();
    flight.observe(delta("text_delta", "before-sdk"));
    now = 105; flight.mark("sessionCheckedMs");
    now = 112; flight.mark("configurationReadyMs");
    now = 140; flight.mark("sdkPromptInvokedMs");
    now = 150; flight.observe({ type: "agent_start" });
    flight.observe(delta("text_delta", ""));
    now = 180; flight.observe(delta("thinking_delta", "private reasoning"));
    now = 200; timings.emitted([{ assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning" } }]);
    now = 250; flight.observe(delta("text_delta", "private text"));
    now = 260; flight.observe(delta("text_delta", "later text"));
    now = 280; timings.emitted([{ assistantMessageEvent: { type: "text_delta", delta: "private text" } }]);
    now = 300; flight.finish("resolved");
    now = 900; flight.mark("sdkPromptInvokedMs");
    expect(timings.snapshot().receipts).toEqual([{
      sequence: 1, status: "resolved", elapsedMs: 200,
      sessionCheckedMs: 5, configurationReadyMs: 12, sdkPromptInvokedMs: 40,
      sdkAgentStartedMs: 50, firstThinkingMs: 80, firstThinkingEmittedMs: 100,
      firstTextMs: 150, firstTextEmittedMs: 180
    }]);
    expect(JSON.stringify(timings.snapshot())).not.toMatch(/private|before-sdk|later text/u);
  });

  it("bounds retention and fences superseded/queued work, with detached snapshots", () => {
    let now = 0;
    const timings = new RuntimeResponseTimings(() => now);
    const old = timings.begin(); old.mark("sdkPromptInvokedMs");
    now = 10;
    const queued = timings.begin(); queued.finish("queued");
    old.observe(delta("text_delta", "stale"));
    queued.observe(delta("text_delta", "unrelated live turn"));
    expect(timings.snapshot().receipts.map(r => r.status)).toEqual(["interrupted", "queued"]);
    expect(timings.snapshot().receipts.every(r => r.firstTextMs === undefined)).toBe(true);
    for (let i = 0; i < 10; i++) { now++; timings.begin().finish("cancelled"); }
    const snapshot = timings.snapshot();
    expect(snapshot.receipts).toHaveLength(8);
    expect(snapshot.receipts[0]?.sequence).toBe(5);
    snapshot.receipts[0]!.elapsedMs = 999;
    expect(timings.snapshot().receipts[0]?.elapsedMs).toBe(0);
  });

  it("shows live elapsed time and leaves missing milestones absent on rejection", () => {
    let now = 20;
    const timings = new RuntimeResponseTimings(() => now);
    const flight = timings.begin();
    now = 40;
    expect(timings.snapshot().receipts[0]).toEqual({ sequence: 1, status: "running", elapsedMs: 20 });
    flight.finish("rejected");
    now = 100;
    expect(timings.snapshot().receipts[0]).toEqual({ sequence: 1, status: "rejected", elapsedMs: 20 });
  });
});
