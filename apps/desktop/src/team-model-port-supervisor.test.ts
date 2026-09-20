import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";
import type { UtilityProcess } from "electron";
import { expect, it, vi } from "vitest";
const fork = vi.hoisted(() => vi.fn());
vi.mock("electron", async () => {
  const { MessageChannel } = await import("node:worker_threads");
  return { MessageChannelMain: MessageChannel, utilityProcess: { fork } };
});
import { TeamModelPortSupervisor } from "./team-model-port-supervisor.js";
import { AgentHostSupervisor } from "./agent-host-supervisor.js";
const id = "11111111-1111-4111-8111-111111111111";
it.each(["restart", "stop", "poison", "suspend"])("wires transfer admission and retirement through the real supervisor on %s", async mode => {
  const host = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn(), stdout: undefined, stderr: undefined });
  fork.mockReturnValue(host);
  const supervisor = new AgentHostSupervisor({ agentHostEntry: "/fixture/host.mjs", appInstanceId: "fixture", expectedRendererOrigin: "app://pi67",
    getStoragePaths: () => ({ storageRoot: "/fixture", capabilityProbeDirectory: "/fixture", sessionCatalogDirectory: "/fixture/projections/session-catalog" }),
    getMainWindow: () => undefined, rendererUrl: "app://pi67/index.html" });
  const stream = () => new Duplex({ read() {}, write(_b, _e, done) { done(); } });
  const signal = new AbortController().signal;
  supervisor.connect(); expect(() => supervisor.teamModelPorts.attach(id, stream(), signal)).toThrow("unavailable");
  host.emit("spawn"); host.emit("message", { type: "agent-host-ready", startup: { profileMode: "fresh", status: "ready", issues: [] } });
  const native = stream(); supervisor.teamModelPorts.attach(id, native, signal);
  if (mode === "restart") supervisor.restart();
  if (mode === "stop") void supervisor.stop();
  if (mode === "poison") host.emit("message", { type: "agent-host-runtime-poisoned", code: "ABORT_WATCHDOG_EXPIRED", operationId: "op-fixture", abortTimeoutMs: 1000 });
  if (mode === "suspend") supervisor.notifyPowerTransition("suspend");
  try {
    expect(native.destroyed).toBe(true);
    expect(() => supervisor.teamModelPorts.attach(id, stream(), signal)).toThrow("unavailable");
  } finally { const stopping = supervisor.stop(); host.emit("exit", 0); await stopping; }
});
function fixture() {
  const host = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  let current: UtilityProcess | undefined = host as unknown as UtilityProcess;
  const supervisor = new TeamModelPortSupervisor(() => current);
  const native = new Duplex({ read() {}, write(_bytes, _encoding, done) { done(); } });
  return { host, supervisor, native, replace() { current = undefined; } };
}
it.each(["exit", "invalidate", "abort", "native-close"])("retires the dedicated transfer on %s", async mode => {
  const f = fixture(), owner = new AbortController();
  const handle = f.supervisor.attach(id, f.native, owner.signal);
  expect(f.host.postMessage).toHaveBeenCalledWith({ type: "team-model-port-attach", requestId: id }, [expect.anything()]);
  if (mode === "exit") f.host.emit("exit", 1);
  if (mode === "invalidate") f.supervisor.invalidate();
  if (mode === "abort") owner.abort();
  if (mode === "native-close") { f.native.destroy(); await new Promise(resolve => setImmediate(resolve)); }
  expect(f.native.destroyed).toBe(true); expect(f.host.listenerCount("exit")).toBe(0); handle.stop();
});
it.each(["not-ready", "invalid-id", "send-failure", "duplicate"])("fails closed on %s", mode => {
  const f = fixture(), owner = new AbortController();
  if (mode === "not-ready") f.replace();
  if (mode === "send-failure") f.host.postMessage.mockImplementation(() => { throw new Error("private detail"); });
  if (mode === "duplicate") f.supervisor.attach(id, new Duplex({ read() {}, write(_b, _e, done) { done(); } }), owner.signal);
  expect(() => f.supervisor.attach(mode === "invalid-id" ? "invalid" : id, f.native, owner.signal)).toThrow("unavailable");
  expect(f.native.destroyed).toBe(true); f.supervisor.invalidate();
});
