import { MessageChannel } from "node:worker_threads";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { TeamModelPortAdmission } from "./team-model-port-admission.js";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const fakePort = () => Object.assign(new EventEmitter(), { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() });
it("accepts a reserved port once and retires the binding on a duplicate", async () => {
  const broker = new TeamModelPortAdmission(), ports = new MessageChannel();
  const stop = vi.fn(), admit = vi.fn(() => ({ stop }));
  const entry = broker.reserve(admit, new AbortController().signal);
  const message = { type: "team-model-port-attach", requestId: entry.requestId };
  try {
    expect(broker.handleMessage({ data: message, ports: [ports.port1] })).toBe(true); await entry.connected;
    expect(admit).toHaveBeenCalledOnce();
    const duplicate = fakePort(); broker.handleMessage({ data: message, ports: [duplicate] });
    expect(duplicate.close).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
  } finally { broker.shutdown(); ports.port2.close(); }
});
it.each(["extra-field", "wrong-id", "two-ports", "no-port"])("rejects invalid transfer: %s", async mode => {
  const broker = new TeamModelPortAdmission(), admit = vi.fn(() => ({ stop() {} }));
  const entry = broker.reserve(admit, new AbortController().signal);
  const rejected = expect(entry.connected).rejects.toThrow("unavailable");
  const first = fakePort(), second = fakePort();
  const message = { type: "team-model-port-attach", requestId: mode === "wrong-id" ? "bad" : entry.requestId,
    ...(mode === "extra-field" ? { teamId: "injected" } : {}) };
  const ports = mode === "no-port" ? [] : mode === "two-ports" ? [first, second] : [first];
  expect(broker.handleMessage({ data: message, ports })).toBe(true);
  for (const port of ports) expect(port.close).toHaveBeenCalledOnce();
  expect(admit).not.toHaveBeenCalled(); broker.shutdown(); await rejected;
});
it.each(["abort", "timeout", "shutdown", "admission-failed"])("rejects and closes late ports after %s", async mode => {
  vi.useFakeTimers(); const broker = new TeamModelPortAdmission(), owner = new AbortController();
  const admit = vi.fn(() => { throw new Error("synthetic private detail"); });
  const entry = broker.reserve(admit, owner.signal), rejected = expect(entry.connected).rejects.toThrow("unavailable");
  const message = { type: "team-model-port-attach", requestId: entry.requestId };
  if (mode === "abort") owner.abort();
  if (mode === "timeout") vi.advanceTimersByTime(5_000);
  if (mode === "shutdown") broker.shutdown();
  if (mode === "admission-failed") broker.handleMessage({ data: message, ports: [fakePort()] });
  await rejected;
  const late = fakePort(); broker.handleMessage({ data: message, ports: [late] });
  expect(late.close).toHaveBeenCalledOnce(); expect(admit).toHaveBeenCalledTimes(mode === "admission-failed" ? 1 : 0);
  broker.shutdown(); expect(vi.getTimerCount()).toBe(0);
});
it("bounds reservations and leaves ordinary renderer attach messages to their route", async () => {
  const broker = new TeamModelPortAdmission(), owner = new AbortController();
  const entries = Array.from({ length: 4 }, (_, index) => broker.reserve(() => ({ stop() {} }), owner.signal, index % 2 ? "worker" : "port"));
  const results = entries.map(entry => expect(entry.connected).rejects.toThrow("unavailable"));
  expect(() => broker.reserve(() => ({ stop() {} }), owner.signal)).toThrow("unavailable");
  expect(broker.handleMessage({ data: { type: "attach-port" }, ports: [] })).toBe(false);
  owner.abort(); await Promise.all(results); broker.shutdown();
  expect(() => broker.reserve(() => ({ stop() {} }), new AbortController().signal)).toThrow("unavailable");
});
it("holds a worker slot without admitting a port until Main preparation is acknowledged", async () => {
  vi.useFakeTimers(); const broker = new TeamModelPortAdmission(), admit = vi.fn(() => ({ stop() {} }));
  const entry = broker.reserve(admit, new AbortController().signal, "worker");
  vi.advanceTimersByTime(12_000); expect(entry.signal.aborted).toBe(false); expect(admit).not.toHaveBeenCalled();
  entry.activate(); vi.advanceTimersByTime(4_999);
  const port = fakePort(); broker.handleMessage({ data: { type: "team-model-port-attach", requestId: entry.requestId }, ports: [port] });
  await entry.connected; expect(admit).toHaveBeenCalledOnce();
  broker.shutdown(); expect(vi.getTimerCount()).toBe(0);
});
it.each(["early-port", "preparation-timeout", "port-timeout", "duplicate-activation", "abort"])("retires a dormant worker reservation on %s", async mode => {
  vi.useFakeTimers(); const broker = new TeamModelPortAdmission(), owner = new AbortController(), admit = vi.fn(() => ({ stop() {} }));
  const entry = broker.reserve(admit, owner.signal, "worker"), rejected = expect(entry.connected).rejects.toThrow();
  const message = { type: "team-model-port-attach", requestId: entry.requestId };
  if (mode === "early-port") broker.handleMessage({ data: message, ports: [fakePort()] });
  if (mode === "preparation-timeout") vi.advanceTimersByTime(65_000);
  if (mode === "port-timeout") { entry.activate(); vi.advanceTimersByTime(5_000); }
  if (mode === "duplicate-activation") { entry.activate(); expect(entry.activate).toThrow(); }
  if (mode === "abort") owner.abort();
  await rejected; expect(entry.activate).toThrow();
  const late = fakePort(); broker.handleMessage({ data: message, ports: [late] });
  expect(late.close).toHaveBeenCalledOnce(); expect(admit).not.toHaveBeenCalled();
  broker.shutdown(); expect(vi.getTimerCount()).toBe(0);
});
it.each(["activation", "transfer"])("checks monotonic deadlines before %s even when timer callbacks are delayed", async mode => {
  vi.useFakeTimers(); const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const broker = new TeamModelPortAdmission(), admit = vi.fn(() => ({ stop() {} }));
  const entry = broker.reserve(admit, new AbortController().signal, "worker"), rejected = expect(entry.connected).rejects.toThrow();
  if (mode === "activation") { clock.mockReturnValue(65_001); expect(entry.activate).toThrow(); }
  else {
    entry.activate(); clock.mockReturnValue(5_001);
    const late = fakePort(); broker.handleMessage({ data: { type: "team-model-port-attach", requestId: entry.requestId }, ports: [late] });
    expect(late.close).toHaveBeenCalledOnce();
  }
  await rejected; expect(admit).not.toHaveBeenCalled(); broker.shutdown();
});
