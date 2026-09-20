import { describe, expect, it, vi } from "vitest";
import { OpenVikingSidecarSupervisor } from "./openviking-sidecar-supervisor.mjs";

describe("OpenViking demand-driven lifecycle", () => {
  it("observes startup and crash state without launching or retaining a stale handle", async () => {
    let finish!: (handle: { stop: () => Promise<void> }) => void;
    let exit!: () => void;
    const launch = vi.fn((_signal: AbortSignal, onExit: () => void) => {
      exit = onExit;
      return new Promise<{ stop: () => Promise<void> }>((resolve) => { finish = resolve; });
    });
    const supervisor = new OpenVikingSidecarSupervisor(launch);
    const handle = { stop: vi.fn(async () => undefined) };
    expect(supervisor.status).toBe("idle");
    expect(supervisor.isCurrent(handle)).toBe(false);
    expect(launch).not.toHaveBeenCalled();
    const starting = supervisor.ensureStarted();
    expect(supervisor.status).toBe("starting");
    await Promise.resolve();
    finish(handle);
    await starting;
    expect(supervisor.status).toBe("running");
    expect(supervisor.isCurrent(handle)).toBe(true);
    expect(supervisor.isCurrent({ ...handle })).toBe(false);
    exit();
    expect(supervisor.status).toBe("failed");
    expect(supervisor.isCurrent(handle)).toBe(false);
    expect(launch).toHaveBeenCalledTimes(1);
    await supervisor.stop();
    expect(supervisor.status).toBe("stopped");
  });

  it.each([
    { fails: false, crashed: false }, { fails: true, crashed: false },
    { fails: false, crashed: true }, { fails: true, crashed: true }
  ])("joins cleanup even after parent exit (failure=$fails, crashed=$crashed)", async ({ fails, crashed }) => {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const handle = { stop: vi.fn(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; })) };
    let exit!: () => void;
    const supervisor = new OpenVikingSidecarSupervisor(async (_signal, onExit) => { exit = onExit; return handle; });
    await supervisor.ensureStarted();
    if (crashed) exit();
    const stopping = supervisor.stop();
    const completion = fails ? expect(stopping).rejects.toThrow("cleanup failed") : stopping;
    expect(supervisor.stop()).toBe(stopping);
    expect(supervisor.status).toBe("stopping");
    expect(supervisor.isCurrent(handle)).toBe(false);
    await expect(supervisor.ensureStarted()).rejects.toThrow(/stopped/u);
    if (fails) fail(new Error("cleanup failed")); else finish();
    await completion;
    expect(supervisor.status).toBe(fails ? "stop-failed" : "stopped");
    expect(supervisor.stop()).toBe(stopping);
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });

  it("replaces a crashed generation without accepting its old handle or late exit", async () => {
    const exits: Array<() => void> = [];
    const supervisor = new OpenVikingSidecarSupervisor(async (_signal, onExit) => {
      exits.push(onExit);
      return { stop: async () => undefined };
    });
    const previous = await supervisor.ensureStarted();
    exits[0]!();
    const current = await supervisor.ensureStarted();
    exits[0]!();
    expect(supervisor.status).toBe("running");
    expect(supervisor.isCurrent(previous)).toBe(false);
    expect(supervisor.isCurrent(current)).toBe(true);
    await supervisor.stop();
  });

  it("does not launch if shutdown wins the initial microtask", async () => {
    const launch = vi.fn(async () => ({ stop: async () => undefined }));
    const supervisor = new OpenVikingSidecarSupervisor(launch);
    const starting = supervisor.ensureStarted();
    const rejected = expect(starting).rejects.toThrow();
    await supervisor.stop();
    await rejected;
    expect(launch).not.toHaveBeenCalled();
  });

  it("is lazy and coalesces concurrent start requests", async () => {
    const handle = { stop: vi.fn(async () => undefined) };
    const launch = vi.fn(async () => handle);
    const supervisor = new OpenVikingSidecarSupervisor(launch);
    expect(launch).not.toHaveBeenCalled();
    const first = supervisor.ensureStarted();
    expect(supervisor.ensureStarted()).toBe(first);
    expect(await first).toBe(handle);
    expect(await supervisor.ensureStarted()).toBe(handle);
    expect(launch).toHaveBeenCalledTimes(1);
    await supervisor.stop();
    await supervisor.stop();
    expect(handle.stop).toHaveBeenCalledTimes(1);
    await expect(supervisor.ensureStarted()).rejects.toThrow(/stopped/u);
  });

  it("blocks after three crashes and never restarts without demand", async () => {
    let exit: () => void = () => undefined;
    const launch = vi.fn(async (_signal: AbortSignal, onExit: () => void) => {
      exit = onExit;
      return { stop: async () => undefined };
    });
    const supervisor = new OpenVikingSidecarSupervisor(launch, () => 100);
    for (let i = 0; i < 3; i += 1) {
      await supervisor.ensureStarted();
      exit();
      exit(); // Duplicate events must not consume another restart.
      expect(supervisor.status).toBe(i === 2 ? "blocked" : "failed");
      expect(launch).toHaveBeenCalledTimes(i + 1);
    }
    await expect(supervisor.ensureStarted()).rejects.toThrow(/budget exhausted/u);
    await supervisor.stop();
  });

  it("expires old failures outside the ten-minute window", async () => {
    let time = 0;
    const supervisor = new OpenVikingSidecarSupervisor(async () => { throw new Error("failed"); }, () => time);
    for (let i = 0; i < 4; i += 1) {
      await expect(supervisor.ensureStarted()).rejects.toThrow("failed");
      expect(supervisor.status).toBe("failed");
      time += 600_001;
    }
    await supervisor.stop();
  });

  it("counts a startup failure plus its exit notification only once", async () => {
    const supervisor = new OpenVikingSidecarSupervisor(async (_signal, onExit) => {
      onExit();
      throw new Error("failed");
    });
    for (let i = 0; i < 3; i += 1) await expect(supervisor.ensureStarted()).rejects.toThrow("failed");
    await expect(supervisor.ensureStarted()).rejects.toThrow(/budget exhausted/u);
    await supervisor.stop();
  });

  it("aborts startup and cleans a late handle without exposing it", async () => {
    let resolveLaunch!: (handle: { stop: () => Promise<void> }) => void;
    let signal: AbortSignal | undefined;
    const handle = { stop: vi.fn(async () => undefined) };
    const supervisor = new OpenVikingSidecarSupervisor((received) => {
      signal = received;
      return new Promise<{ stop: () => Promise<void> }>((resolve) => { resolveLaunch = resolve; });
    });
    const starting = supervisor.ensureStarted();
    const rejected = expect(starting).rejects.toThrow(/interrupted/u);
    await Promise.resolve();
    const stopping = supervisor.stop();
    expect(supervisor.status).toBe("stopping");
    expect(signal?.aborted).toBe(true);
    resolveLaunch(handle);
    await stopping;
    await rejected;
    expect(handle.stop).toHaveBeenCalledTimes(1);
    expect(supervisor.status).toBe("stopped");
  });

  it.each([false, true])("does not hide cleanup failures during interrupted startup (synchronous=%s)", async (synchronous) => {
    let resolveLaunch!: (handle: { stop: () => Promise<void> }) => void;
    const supervisor = new OpenVikingSidecarSupervisor(() => new Promise<{ stop: () => Promise<void> }>((resolve) => {
      resolveLaunch = resolve;
    }));
    const starting = supervisor.ensureStarted();
    const rejected = expect(starting).rejects.toThrow("cleanup failed");
    await Promise.resolve();
    const stopping = supervisor.stop();
    const stopRejected = expect(stopping).rejects.toThrow("cleanup failed");
    resolveLaunch({ stop: () => {
      if (synchronous) throw new Error("cleanup failed");
      return Promise.reject(new Error("cleanup failed"));
    } });
    await Promise.all([rejected, stopRejected]);
    expect(supervisor.status).toBe("stop-failed");
  });
});
