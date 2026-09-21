import { describe, expect, it, vi } from "vitest";
import { initializePackagedRuntime } from "./electron-runtime-scenarios.mjs";

function fixture(visible, ready) {
  const waitFor = vi.fn(() => ready);
  const inspector = { isVisible: async () => visible, getByRole: () => ({ waitFor }) };
  return {
    waitFor,
    application: { evaluate: async () => undefined },
    window: {
      getByRole: role => role === "complementary" ? inspector : { click: async () => undefined },
      locator: () => ({ waitFor: async () => undefined })
    }
  };
}

describe("packaged initialization readiness", () => {
  it("does not end the asset stage while a visible inspector is still loading", async () => {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const f = fixture(true, ready);
    let completed = false;
    const measurement = initializePackagedRuntime(f.application, f.window, "/fixture").then(() => { completed = true; });
    await vi.waitFor(() => expect(f.waitFor).toHaveBeenCalled());
    expect(completed).toBe(false);
    release();
    await measurement;
    expect(completed).toBe(true);
  });

  it("does not wait for a closed inspector", async () => {
    const f = fixture(false, new Promise(() => {}));
    await initializePackagedRuntime(f.application, f.window, "/fixture");
    expect(f.waitFor).not.toHaveBeenCalled();
  });

  it("rejects a failed visible inspector instead of reporting a smaller successful sample", async () => {
    const f = fixture(true, undefined);
    f.waitFor.mockRejectedValue(new Error("inspector-not-ready"));
    await expect(initializePackagedRuntime(f.application, f.window, "/fixture")).rejects.toThrow("inspector-not-ready");
  });
});
