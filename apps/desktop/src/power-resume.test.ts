import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { registerPowerResumeRecovery } from "./power-resume.js";

describe("power resume recovery", () => {
  it("notifies Host policy on suspend/resume even without a window", () => {
    const source = new EventEmitter(), events: string[] = [];
    const unregister = registerPowerResumeRecovery({ source, getMainWindow: () => undefined,
      onSuspend: () => events.push("suspend"), onResume: () => events.push("resume") });
    source.emit("suspend"); source.emit("resume");
    expect(events).toEqual(["suspend", "resume"]);
    unregister(); source.emit("suspend"); source.emit("resume");
    expect(events).toHaveLength(2);
    expect(source.listenerCount("suspend")).toBe(0);
    expect(source.listenerCount("resume")).toBe(0);
  });
  it("notifies only a live renderer and unregisters cleanly", () => {
    const source = new EventEmitter();
    const send = vi.fn();
    const onResume = vi.fn();
    let destroyed = false;
    const unregister = registerPowerResumeRecovery({
      source,
      onResume,
      getMainWindow: () => ({
        isDestroyed: () => destroyed,
        webContents: { isDestroyed: () => false, send }
      })
    });

    source.emit("resume");
    expect(onResume).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("pi67:power-resumed");
    expect(onResume.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);

    destroyed = true;
    source.emit("resume");
    expect(onResume).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledOnce();

    unregister();
    destroyed = false;
    source.emit("resume");
    expect(onResume).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledOnce();
  });

  it("ignores resume events while no renderer exists", () => {
    const source = new EventEmitter();
    const unregister = registerPowerResumeRecovery({ source, getMainWindow: () => undefined });

    expect(() => source.emit("resume")).not.toThrow();
    unregister();
  });
});
