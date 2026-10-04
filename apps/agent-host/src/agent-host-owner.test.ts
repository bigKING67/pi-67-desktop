import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { watchAgentHostOwner } from "./agent-host-owner.js";

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  const parent = new EventEmitter(), lost = vi.fn(), forceExit = vi.fn();
  const dispose = watchAgentHostOwner(parent, lost, forceExit);
  return { parent, lost, forceExit, dispose };
}

function port() {
  return Object.assign(new EventEmitter(), { close: vi.fn(), start: vi.fn(), postMessage: vi.fn() });
}

it("observes Main loss before asynchronous startup completes, exactly once", () => {
  const { parent, lost } = fixture(), owner = port();
  parent.emit("message", { data: { type: "agent-host-owner" }, ports: [owner] });
  expect(owner.start).toHaveBeenCalledOnce();
  owner.emit("close"); owner.emit("close");
  vi.advanceTimersByTime(10_000);
  expect(lost).toHaveBeenCalledOnce();
  expect(owner.close).toHaveBeenCalledOnce();
});

it("bounds the orphan window when Main dies before transferring ownership", () => {
  const { parent, lost } = fixture();
  parent.emit("message", { data: { type: "attach-port" }, ports: [port()] });
  vi.advanceTimersByTime(9_999);
  expect(lost).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(lost).toHaveBeenCalledOnce();
  const late = port();
  parent.emit("message", { data: { type: "agent-host-owner" }, ports: [late] });
  expect(late.close).toHaveBeenCalledOnce();
  expect(late.start).not.toHaveBeenCalled();
});

it("forces exit if owner-loss disposal never settles, without Main's watchdog", () => {
  const { parent, lost, forceExit } = fixture(), owner = port();
  parent.emit("message", { data: { type: "agent-host-owner" }, ports: [owner] });
  owner.emit("close");
  expect(lost).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1_249);
  expect(forceExit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(forceExit).toHaveBeenCalledOnce();
});

it("does not impose a task/startup deadline or allow duplicate ports to replace the owner", () => {
  const { parent, lost, forceExit, dispose } = fixture(), owner = port(), duplicate = port();
  parent.emit("message", { data: { type: "agent-host-owner" }, ports: [owner] });
  parent.emit("message", { data: { type: "agent-host-owner" }, ports: [duplicate] });
  duplicate.emit("close");
  vi.advanceTimersByTime(60_000);
  expect(duplicate.close).toHaveBeenCalledOnce();
  expect(owner.close).not.toHaveBeenCalled();
  expect(lost).not.toHaveBeenCalled();
  dispose(); owner.emit("close"); dispose();
  expect(lost).not.toHaveBeenCalled();
  expect(owner.close).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(60_000);
  expect(forceExit).not.toHaveBeenCalled();
});

it.each(["extra-field", "zero-ports", "two-ports"])("fails closed on an invalid first owner: %s", kind => {
  const { parent, lost } = fixture(), first = port(), second = port();
  const ports = kind === "zero-ports" ? [] : kind === "two-ports" ? [first, second] : [first];
  parent.emit("message", { data: { type: "agent-host-owner", ...(kind === "extra-field" ? { path: "invalid" } : {}) }, ports });
  expect(lost).toHaveBeenCalledOnce();
  for (const rejected of ports) expect(rejected.close).toHaveBeenCalledOnce();
});
