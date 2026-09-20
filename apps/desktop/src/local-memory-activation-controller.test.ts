import { describe, expect, it, vi } from "vitest";
import { LocalMemoryActivationController } from "./local-memory-activation-controller.js";
import type { OpenVikingSidecarStatus } from "./openviking-sidecar-supervisor.mjs";
import { LocalMemorySupervisor } from "./local-memory-supervisor.js";

function fixture(enabled = false) {
  let status: OpenVikingSidecarStatus = "idle";
  const connection = { endpoint: "http://127.0.0.1:12345", apiKey: "synthetic-scoped", account: "private-11111111-1111-4111-8111-111111111111",
    user: "desktop", localProfileId: "11111111-1111-4111-8111-111111111111" };
  const store = { load: vi.fn(async () => enabled), save: vi.fn(async (value: boolean) => { enabled = value; }) };
  const service = { get status() { return status; }, connect: vi.fn(async () => { status = "running"; return connection; }),
    inspect: vi.fn(() => connection), checkHealth: vi.fn(async () => "healthy" as const), stop: vi.fn(async () => { status = "stopped"; }) };
  const prerequisites = vi.fn(async (): Promise<"ready" | "runtime-missing" | "models-missing"> => "ready");
  const create = () => new LocalMemoryActivationController({ store, service, prerequisites });
  return { controller: create(), create, store, service, prerequisites, connection };
}
describe("Main private memory consent", () => {
  it("warms only saved launch consent once, never new enablement or unknown storage", async () => {
    const inactive = fixture();
    expect(await inactive.controller.warmup()).toBe("skipped");
    await inactive.controller.initialize();
    expect(await inactive.controller.warmup()).toBe("skipped");
    await inactive.controller.setEnabled(true);
    expect(await inactive.controller.warmup()).toBe("skipped");
    expect(inactive.service.connect).not.toHaveBeenCalled();
    const active = inactive.create(); await active.initialize();
    expect(await active.warmup()).toBe("ready");
    expect(await active.warmup()).toBe("skipped");
    expect(inactive.service.connect).toHaveBeenCalledOnce();
    const unknown = fixture(true); unknown.store.load.mockRejectedValue(new Error("private"));
    await unknown.controller.initialize();
    expect(await unknown.controller.warmup()).toBe("skipped");
    expect(unknown.service.connect).not.toHaveBeenCalled();
  });
  it("does not retry failed background preparation or reopen after shutdown", async () => {
    const active = fixture(true); await active.controller.initialize();
    active.service.connect.mockRejectedValue(new Error("private"));
    expect(await active.controller.warmup()).toBe("unavailable");
    expect(await active.controller.warmup()).toBe("skipped");
    expect(active.service.connect).toHaveBeenCalledOnce();
    const stopped = fixture(true); await stopped.controller.initialize(); await stopped.controller.stop();
    expect(await stopped.controller.warmup()).toBe("skipped");
    expect(stopped.service.connect).not.toHaveBeenCalled();
  });
  it("withholds late background success when disable wins startup", async () => {
    const active = fixture(true); await active.controller.initialize();
    let finish!: (connection: typeof active.connection) => void;
    active.service.connect.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const warming = active.controller.warmup();
    expect(await active.controller.warmup()).toBe("skipped");
    await active.controller.setEnabled(false);
    finish(active.connection);
    expect(await warming).toBe("unavailable");
    expect(await active.controller.warmup()).toBe("skipped");
  });
  it("fences observation by launch consent and immediate revocation without connect", async () => {
    const disabled = fixture(); await disabled.controller.initialize();
    expect(() => disabled.controller.inspect()).toThrow();
    expect(disabled.service.inspect).not.toHaveBeenCalled();
    const active = fixture(true); await active.controller.initialize();
    expect(active.controller.inspect()).toEqual(active.connection);
    const stopping = active.controller.setEnabled(false);
    expect(() => active.controller.inspect()).toThrow();
    await stopping;
    expect(active.service.connect).not.toHaveBeenCalled();
  });
  it("does not probe without launch consent and withholds success after consent is revoked", async () => {
    const disabled = fixture(); await disabled.controller.initialize();
    expect((await disabled.controller.check()).health).toBe("not-running");
    expect(disabled.service.checkHealth).not.toHaveBeenCalled();
    const active = fixture(true); await active.controller.initialize();
    let finish!: (health: "healthy") => void;
    active.service.checkHealth.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const check = active.controller.check();
    await active.controller.setEnabled(false);
    finish("healthy");
    expect(await check).toMatchObject({ health: "not-running", activation: { preference: "disabled" } });
    expect(active.service.connect).not.toHaveBeenCalled();
  });
  it("starts disabled, observes without IO and only admits saved enablement after a new app controller", async () => {
    const { controller, create, service, store, prerequisites } = fixture();
    await controller.initialize();
    expect(controller.selectedAtLaunch).toBe(false);
    await expect(controller.connect()).rejects.toThrow(/activation/u);
    for (let i = 0; i < 3; i++) controller.get();
    expect(store.load).toHaveBeenCalledTimes(1); expect(prerequisites).not.toHaveBeenCalled();
    expect(await controller.setEnabled(true)).toMatchObject({ preference: "enabled", selectedAtLaunch: false, restartRequired: true, busy: false, lifecycle: "idle" });
    await expect(controller.connect()).rejects.toThrow(/activation/u);
    expect(service.connect).not.toHaveBeenCalled();
    const restarted = create(); await restarted.initialize();
    expect(restarted.selectedAtLaunch).toBe(true);
    await restarted.connect(); expect(restarted.get()).toMatchObject({ lifecycle: "running", restartRequired: false });
    await restarted.stop();
  });
  it.each(["runtime-missing", "models-missing"] as const)("refuses activation before saving when %s", async (issue) => {
    const { controller, store, prerequisites, service } = fixture();
    prerequisites.mockResolvedValue(issue); await controller.initialize();
    expect(await controller.setEnabled(true)).toMatchObject({ preference: "disabled", issue });
    expect(store.save).not.toHaveBeenCalled(); expect(service.connect).not.toHaveBeenCalled();
  });
  it("projects unreadable storage and prerequisite failures without raw errors", async () => {
    const { controller, store, prerequisites } = fixture();
    store.load.mockRejectedValue(new Error("secret-path")); await controller.initialize();
    expect(controller.get()).toMatchObject({ preference: "unknown", issue: "storage", selectedAtLaunch: false });
    prerequisites.mockRejectedValue(new Error("secret-key"));
    expect(await controller.setEnabled(true)).toMatchObject({ preference: "unknown", issue: "prerequisites" });
    expect(JSON.stringify(controller.get())).not.toMatch(/secret/u);
  });
  it("revokes cached broker references immediately and waits for cleanup even if preference save fails", async () => {
    const { controller, store, service } = fixture(true);
    await controller.initialize();
    const broker = new LocalMemorySupervisor(() => controller);
    expect(await broker.operation({ type: "local-memory-connect", requestId: "first" })).toMatchObject({ ok: true });
    let finish!: () => void;
    service.stop.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    store.save.mockRejectedValue(new Error("storage-secret"));
    let settled = false;
    const change = controller.setEnabled(false).then(value => { settled = true; return value; });
    expect(await broker.operation({ type: "local-memory-connect", requestId: "late" })).toMatchObject({ ok: false });
    await expect(controller.setEnabled(true)).rejects.toThrow(/unavailable/u);
    expect(controller.get()).toMatchObject({ busy: true }); expect(settled).toBe(false);
    finish(); expect(await change).toMatchObject({ preference: "unknown", issue: "storage", busy: false });
    expect(service.connect).toHaveBeenCalledTimes(1);
  });
  it("withholds an in-flight connection and requires another app launch after disable then enable", async () => {
    const { controller, service, connection } = fixture(true);
    await controller.initialize();
    let finish!: (value: typeof connection) => void;
    service.connect.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const connecting = controller.connect();
    const rejected = expect(connecting).rejects.toThrow(/revoked/u);
    expect(await controller.setEnabled(false)).toMatchObject({ preference: "disabled", lifecycle: "stopped" });
    finish(connection); await rejected;
    expect(await controller.setEnabled(true)).toMatchObject({ preference: "enabled", restartRequired: true });
    await expect(controller.connect()).rejects.toThrow(/activation/u);
  });
  it("does not turn cleanup failure into successful stopping", async () => {
    const { controller, service } = fixture(true); await controller.initialize();
    service.stop.mockRejectedValue(new Error("native-secret"));
    expect(await controller.setEnabled(false)).toMatchObject({ preference: "disabled", issue: "stop-failed" });
    await expect(controller.connect()).rejects.toThrow();
  });
  it("rejects changes before initialization and prevents a late initialization from reopening shutdown", async () => {
    const { controller, store, service } = fixture(true);
    let finish!: (enabled: boolean) => void;
    store.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const initializing = controller.initialize();
    await expect(controller.setEnabled(true)).rejects.toThrow();
    await expect(controller.initialize()).rejects.toThrow();
    await controller.stop(); finish(true); await initializing;
    expect(controller.selectedAtLaunch).toBe(false);
    await expect(controller.connect()).rejects.toThrow(); expect(service.connect).not.toHaveBeenCalled();
  });
  it("shutdown drains a pending preference write even when native cleanup rejects", async () => {
    const { controller, store, service } = fixture(); await controller.initialize();
    let entered!: () => void, finish!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    store.save.mockImplementation(() => { entered(); return new Promise<void>(resolve => { finish = resolve; }); });
    const change = controller.setEnabled(true); await writing;
    service.stop.mockRejectedValue(new Error("native-secret"));
    let settled = false;
    const stopping = controller.stop().finally(() => { settled = true; });
    const rejected = expect(stopping).rejects.toThrow("Private memory cleanup failed.");
    await Promise.resolve(); expect(settled).toBe(false);
    finish(); await change; await rejected;
    await expect(controller.connect()).rejects.toThrow();
  });
});
