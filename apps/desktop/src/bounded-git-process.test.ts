import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureGitProcess, type GitChild } from "./bounded-git-process.js";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));

function processFixture(pid = 1234) {
  return Object.assign(new EventEmitter(), {
    pid,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true)
  });
}

function startCancellation(child: ReturnType<typeof processFixture>) {
  const controller = new AbortController();
  const result = captureGitProcess({
    child: child as unknown as GitChild,
    stage: "worktree-add",
    timeoutMs: 10_000,
    outputLimitBytes: 1024,
    signal: controller.signal,
    platform: "win32"
  }).catch((error: unknown) => error);
  controller.abort();
  return result;
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("Windows Git cancellation cleanup", () => {
  it("keeps cleanup unconfirmed when cancellation races root close", async () => {
    const child = processFixture();
    const result = startCancellation(child);
    child.emit("close", 0, null);
    expect(await result).toMatchObject({ code: "cancelled", details: { cleanupConfirmed: false } });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("targets the tree before killing the root and waits for successful tree cleanup", async () => {
    vi.useFakeTimers();
    const child = processFixture();
    const killer = processFixture(4321);
    child.kill.mockImplementation(() => { child.emit("close", null, "SIGTERM"); return true; });
    spawn.mockReturnValue(killer);
    const result = startCancellation(child);
    await vi.advanceTimersByTimeAsync(0);
    expect(child.kill).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(expect.stringContaining("taskkill.exe"),
      ["/PID", "1234", "/T"], expect.objectContaining({ shell: false, stdio: "ignore" }));
    child.emit("close", null, "SIGTERM");
    killer.emit("close", 0);
    expect(await result).toMatchObject({ code: "cancelled", details: { cleanupConfirmed: true } });
  });

  it("escalates an unsuccessful tree command while the root is still live", async () => {
    vi.useFakeTimers();
    const child = processFixture();
    const gentle = processFixture(4321);
    const forced = processFixture(4322);
    spawn.mockReturnValueOnce(gentle).mockReturnValueOnce(forced);
    const result = startCancellation(child);
    await vi.advanceTimersByTimeAsync(0);
    gentle.emit("close", 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(spawn).toHaveBeenLastCalledWith(expect.any(String), ["/PID", "1234", "/T", "/F"], expect.any(Object));
    child.emit("close", null, "SIGKILL");
    forced.emit("close", 0);
    expect(await result).toMatchObject({ details: { cleanupConfirmed: true } });
  });

  it("does not treat root closure plus failed taskkill as tree cleanup", async () => {
    vi.useFakeTimers();
    const child = processFixture();
    const killer = processFixture(4321);
    spawn.mockReturnValue(killer);
    const result = startCancellation(child);
    await vi.advanceTimersByTimeAsync(0);
    child.emit("close", null, "SIGTERM");
    killer.emit("close", 1);
    expect(await result).toMatchObject({ details: { cleanupConfirmed: false } });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it.each(["hang", "error", "throw"])("bounds taskkill %s and preserves the cancellation error", async (failure) => {
    vi.useFakeTimers();
    const child = processFixture();
    const killers: ReturnType<typeof processFixture>[] = [];
    spawn.mockImplementation(() => {
      if (failure === "throw") throw new Error("spawn failed");
      const killer = processFixture(4321 + killers.length);
      killers.push(killer);
      if (failure === "error") queueMicrotask(() => killer.emit("error", new Error("spawn failed")));
      return killer;
    });
    const result = startCancellation(child);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toMatchObject({ code: "cancelled", details: { cleanupConfirmed: false } });
    if (failure === "hang") {
      expect(killers).toHaveLength(2);
      for (const killer of killers) expect(killer.kill).toHaveBeenCalled();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
