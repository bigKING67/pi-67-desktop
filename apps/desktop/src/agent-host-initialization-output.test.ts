import { describe, expect, it, vi } from "vitest";
import { AgentHostInitializationOutputForwarder } from "./agent-host-initialization-output.js";

describe("AgentHostInitializationOutputForwarder", () => {
  it.each(["operation-abort", "operation-execution", "operation-queues", "operation-receipt",
    "operation-prompt-catalog", "operation-prompt-configuration"])("forwards bounded Operation phase %s", (stage) => {
    const emit = vi.fn<(line: string) => void>();
    const forwarder = new AgentHostInitializationOutputForwarder(emit);
    const record = `[agent-host:shutdown] ${JSON.stringify({ sequence: 1, stage, outcome: "completed", durationMs: 20 })}`;
    forwarder.write(`${record}\n`);
    expect(emit).toHaveBeenCalledWith(record);
  });

  it("projects split shutdown stages without private fields and rejects invalid or excessive records", () => {
    const emit = vi.fn<(line: string) => void>();
    const forwarder = new AgentHostInitializationOutputForwarder(emit);
    const prefix = "[agent-host:shutdown] ";
    const valid = { sequence: 1, stage: "runtime-session", outcome: "started", durationMs: 0 };
    const record = `${prefix}${JSON.stringify({ ...valid, secret: "private" })}\n`;
    forwarder.write(record.slice(0, 35));
    expect(emit).not.toHaveBeenCalled();
    forwarder.write(record.slice(35));
    for (const invalid of [
      { stage: "private" }, { outcome: "unknown" }, { sequence: 0 }, { sequence: 65 },
      { sequence: 1.5 }, { durationMs: -1 }, { durationMs: 60_001 }, { durationMs: 1.5 }
    ]) forwarder.write(`${prefix}${JSON.stringify({ ...valid, ...invalid })}\n`);
    forwarder.write(`${prefix}null\n${prefix}not-json\n`);
    forwarder.write(`${prefix}${JSON.stringify({ ...valid, secret: "x".repeat(8_192) })}\n`);
    expect(emit.mock.calls).toEqual([[`${prefix}${JSON.stringify(valid)}`]]);
    for (let index = 0; index < 129; index += 1) forwarder.write(`${prefix}${JSON.stringify(valid)}\n`);
    expect(emit).toHaveBeenCalledTimes(128);
  });

  it("projects bounded Prompt ACK stages and drops payloads, unknown stages and invalid counters", () => {
    const emit = vi.fn<(line: string) => void>();
    const forwarder = new AgentHostInitializationOutputForwarder(emit);
    const prefix = "[agent-host:prompt-ack] ";
    const valid = { attempt: 1, stage: "receipt-write-started", elapsedMs: 17 };
    forwarder.write(`${prefix}${JSON.stringify({ ...valid, prompt: "private", path: "private" })}\n`);
    for (const invalid of [{ stage: "private" }, { attempt: 65 }, { elapsedMs: -1 }, { elapsedMs: 1.5 }]) {
      forwarder.write(`${prefix}${JSON.stringify({ ...valid, ...invalid })}\n`);
    }
    forwarder.write(`${prefix}${JSON.stringify({ ...valid, private: "x".repeat(8_192) })}\n`);
    expect(emit.mock.calls).toEqual([[`${prefix}${JSON.stringify(valid)}`]]);
    for (let index = 0; index < 1_025; index += 1) forwarder.write(`${prefix}${JSON.stringify(valid)}\n`);
    expect(emit).toHaveBeenCalledTimes(1_024);
  });
  it("forwards split initialization records with only the bounded public fields", () => {
    const emit = vi.fn<(line: string) => void>();
    const forwarder = new AgentHostInitializationOutputForwarder(emit);

    forwarder.write("private utility output\n[agent-host:init] {\"stage\":\"load-model-");
    forwarder.write("runtime\",\"outcome\":\"completed\",\"durationMs\":41.6,\"secret\":\"drop\"}\r\n");

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(
      '[agent-host:init] {"stage":"load-model-runtime","outcome":"completed","durationMs":42}'
    );
  });

  it.each([
    "validate-packages",
    "load-session-resources",
    "activate-session",
    "capability-source-verify",
    "capability-profile-inspect",
    "capability-profile-copy",
    "capability-profile-verify"
  ])("forwards the truthful restore stage %s", (stage) => {
    const emit = vi.fn<(line: string) => void>();
    const forwarder = new AgentHostInitializationOutputForwarder(emit);

    forwarder.write(`[agent-host:init] ${JSON.stringify({
      stage,
      outcome: "completed",
      durationMs: 17.4
    })}\n`);

    expect(emit).toHaveBeenCalledWith(
      `[agent-host:init] ${JSON.stringify({ stage, outcome: "completed", durationMs: 17 })}`
    );
  });

  it("drops malformed, unknown and overlong utility output", () => {
    const emit = vi.fn<(line: string) => void>();
    const forwarder = new AgentHostInitializationOutputForwarder(emit);

    forwarder.write("[agent-host:init] not-json\n");
    forwarder.write('[agent-host:init] {"stage":"private","outcome":"completed","durationMs":1}\n');
    forwarder.write('[agent-host:init] {"stage":"create-session","outcome":"other","durationMs":1}\n');
    forwarder.write(`[agent-host:init] ${"x".repeat(9_000)}`);
    forwarder.write("\n");

    expect(emit).not.toHaveBeenCalled();
  });
});
