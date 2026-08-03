import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { registerPowerResumeRecovery } from "./power-resume.js";

describe("power resume recovery", () => {
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
