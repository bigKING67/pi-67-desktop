import { describe, expect, it, vi } from "vitest";
import { AgentHostInitializationOutputForwarder } from "./agent-host-initialization-output.js";

describe("AgentHostInitializationOutputForwarder", () => {
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
