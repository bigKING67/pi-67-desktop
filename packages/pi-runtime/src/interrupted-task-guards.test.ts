import { describe, expect, it, vi } from "vitest";
import { PiRuntimePromptActions } from "./pi-runtime-prompt-actions.js";

describe("interrupted task continuation admission", () => {
  it.each(["authorization", "configuration", "cancelled"] as const)("does not enter Pi after %s rejection", async failure => {
    const controller = new AbortController();
    const requireSession = vi.fn();
    const assertWritable = vi.fn(async () => {
      if (failure === "authorization") throw new Error("Current Session is read-only");
      if (failure === "cancelled") controller.abort(new Error("Cancelled before inference"));
    });
    const assertReady = vi.fn(async () => { throw new Error("Configuration changed"); });
    const options = { assertWritable, configurationReload: { assertReady }, sessionBindings: { requireSession } };
    const actions = new PiRuntimePromptActions(options as unknown as ConstructorParameters<typeof PiRuntimePromptActions>[0]);
    await expect(actions.continueInterrupted("leaf", controller.signal)).rejects.toThrow();
    expect(requireSession).not.toHaveBeenCalled();
    expect(assertWritable).toHaveBeenCalledOnce();
    expect(assertReady).toHaveBeenCalledTimes(failure === "configuration" ? 1 : 0);
  });
});
