import type { AgentRuntime } from "@pi67/pi-runtime";
import { describe, expect, it, vi } from "vitest";
import { dispatchHostCommand } from "./host-command-dispatcher.js";

// approvalMode is no longer on the wire or a runtime input; the runtime applies the Host default.
describe("Host workspace policy without approvalMode", () => {
  it("passes only trust to the runtime for workspace.setTrust", async () => {
    const setWorkspacePolicy = vi.fn(() => "auto" as const);
    const runtime = {
      getTaskToolMode: vi.fn(() => "auto" as const),
      setWorkspacePolicy,
      reloadResources: vi.fn(async () => ({ resources: [] }))
    } as unknown as AgentRuntime;

    await dispatchHostCommand(runtime, { type: "workspace.setTrust", payload: { trust: "trusted" } }, { sendEvent: vi.fn() } as never);
    expect(setWorkspacePolicy).toHaveBeenCalledWith("trusted");
  });

  it("forwards runtime.initialize and workspace.open payloads unchanged", async () => {
    const initializeRuntime = vi.fn(async () => ({}));
    for (const type of ["runtime.initialize", "workspace.open"] as const) {
      await dispatchHostCommand({} as AgentRuntime, { type, payload: { cwd: "/w", trust: "trusted" } }, { initializeRuntime } as never);
    }
    expect(initializeRuntime).toHaveBeenNthCalledWith(1, {}, { cwd: "/w", trust: "trusted" });
    expect(initializeRuntime).toHaveBeenNthCalledWith(2, {}, { cwd: "/w", trust: "trusted" });
  });
});
