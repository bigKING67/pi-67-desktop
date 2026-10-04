import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("shutdown phase observations", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PI67_TEST_CAPTURE_SHUTDOWN", "1");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each([
    { environment: "production", capture: "1" },
    { environment: "test", capture: "" }
  ])("is silent without the isolated test opt-in: $environment/$capture", async ({ environment, capture }) => {
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("PI67_TEST_CAPTURE_SHUTDOWN", capture);
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { observeShutdownPhase } = await import("./shutdown-phase-observation.js");
    expect(await observeShutdownPhase("host-operations", async () => 42)).toBe(42);
    expect(write).not.toHaveBeenCalled();
  });

  it("distinguishes a pending boundary from completion and never includes its result", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { observeShutdownPhase } = await import("./shutdown-phase-observation.js");
    let finish!: (value: string) => void;
    const operation = observeShutdownPhase("runtime-session", () => new Promise<string>((resolve) => { finish = resolve; }));
    const records = () => write.mock.calls.map(([line]) => JSON.parse(String(line).slice("[agent-host:shutdown] ".length)));
    expect(records()).toEqual([{ sequence: 1, stage: "runtime-session", outcome: "started", durationMs: expect.any(Number) }]);
    finish("private result");
    expect(await operation).toBe("private result");
    expect(records()).toHaveLength(2);
    expect(records()[1]).toEqual({ sequence: 1, stage: "runtime-session", outcome: "completed", durationMs: expect.any(Number) });
    expect(JSON.stringify(records())).not.toContain("private");
  });

  it("preserves the original error while projecting only a failed outcome", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { observeShutdownPhase } = await import("./shutdown-phase-observation.js");
    const failure = new Error("private payload");
    await expect(observeShutdownPhase("runtime-catalog", async () => { throw failure; })).rejects.toBe(failure);
    expect(write).toHaveBeenCalledTimes(2);
    expect(String(write.mock.lastCall?.[0])).toContain('"outcome":"failed"');
    expect(JSON.stringify(write.mock.calls)).not.toContain("private");
  });

  it("bounds output without skipping later cleanup work", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { observeShutdownPhase } = await import("./shutdown-phase-observation.js");
    const cleanup = vi.fn(async () => undefined);
    for (let index = 0; index < 65; index += 1) await observeShutdownPhase("host-requests", cleanup);
    expect(write).toHaveBeenCalledTimes(128);
    expect(cleanup).toHaveBeenCalledTimes(65);
  });

  it("continues cleanup when stderr cannot be written", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => { throw new Error("closed stderr"); });
    const { observeShutdownPhase } = await import("./shutdown-phase-observation.js");
    expect(await observeShutdownPhase("host-workspaces", async () => "done")).toBe("done");
  });
});
