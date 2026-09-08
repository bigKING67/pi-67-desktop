import { afterEach, expect, it, vi } from "vitest";
import { FakePort, FakeRuntime } from "./host-server-multi-task-fixture.js";

afterEach(() => vi.useRealTimers());

it("correlates concurrent waiters and accepts messages already delivered", async () => {
  const port = new FakePort();
  const first = port.waitForMessage((value) => value === "first");
  const second = port.waitForMessage((value) => value === "second");
  port.postMessage("unrelated");
  port.postMessage("second");
  await expect(second).resolves.toBe("second");
  port.postMessage("first");
  await expect(first).resolves.toBe("first");
  await expect(port.waitForMessage((value) => value === "second")).resolves.toBe("second");
});

it("removes resolved waiters and their deadline timers", async () => {
  vi.useFakeTimers();
  const port = new FakePort();
  const predicate = vi.fn((value: unknown) => value === "ready");
  const pending = port.waitForMessage(predicate);
  port.postMessage("ready");
  await pending;
  port.postMessage("later");
  expect(predicate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects missing messages at the original one-second deadline and removes the waiter", async () => {
  vi.useFakeTimers();
  const port = new FakePort();
  const predicate = vi.fn(() => false);
  const rejected = expect(port.waitForMessage(predicate)).rejects.toThrow("Timed out");
  await vi.advanceTimersByTimeAsync(1_000);
  await rejected;
  port.postMessage("late");
  expect(predicate).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects pending waiters and clears deadlines when the port closes", async () => {
  vi.useFakeTimers();
  const port = new FakePort();
  const rejected = expect(port.waitForMessage(() => false)).rejects.toThrow("port closed");
  port.close();
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds missing prompt-start signals without retaining deadline timers", async () => {
  vi.useFakeTimers();
  const runtime = new FakeRuntime("deadline-test");
  const rejected = expect(runtime.waitForPromptStart()).rejects.toThrow("prompt start");
  await vi.advanceTimersByTimeAsync(1_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the prompt-start deadline when the Runtime starts", async () => {
  vi.useFakeTimers();
  const runtime = new FakeRuntime("started-test");
  const started = runtime.waitForPromptStart();
  const completion = runtime.submitPrompt("test", []);
  await started;
  expect(vi.getTimerCount()).toBe(0);
  runtime.completePrompt();
  await completion;
});
