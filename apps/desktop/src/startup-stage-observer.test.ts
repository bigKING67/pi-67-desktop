import { describe, expect, it, vi } from "vitest";
import { observeStartupStage } from "./startup-stage-observer.js";

describe("startup stage observer", () => {
  it("reports only slow stages without serializing operation data", async () => {
    const log = vi.fn();
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(1_350);

    await expect(observeStartupStage(
      "workbench-state",
      async () => ({ privateState: "not logged" }),
      { log, now }
    )).resolves.toEqual({ privateState: "not logged" });

    expect(log).toHaveBeenCalledWith(
      "Application startup slow stage=workbench-state durationMs=1250"
    );
  });

  it("does not add noise for normal startup stages", async () => {
    const log = vi.fn();
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(999);

    await observeStartupStage("main-window", async () => undefined, { log, now });

    expect(log).not.toHaveBeenCalled();
  });

  it("preserves failures while still reporting a slow stage", async () => {
    const log = vi.fn();
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(2_100);

    await expect(observeStartupStage(
      "profile",
      async () => { throw new Error("startup failed"); },
      { log, now }
    )).rejects.toThrow("startup failed");

    expect(log).toHaveBeenCalledWith(
      "Application startup slow stage=profile durationMs=2000"
    );
  });
});
