import type { AgentRuntime } from "@pi67/pi-runtime";
import { describe, expect, it, vi } from "vitest";
import { dispatchHostCommand } from "./host-command-dispatcher.js";

// approvalMode is deprecated on the wire (removed next protocol revision): the Host default is the
// only policy input, whether or not an older renderer still sends the field.
describe("deprecated approvalMode at the Host", () => {
  it("uses the Host default when workspace.setTrust omits approvalMode", async () => {
    const setWorkspacePolicy = vi.fn(() => "auto" as const);
    const runtime = {
      getTaskToolMode: vi.fn(() => "auto" as const),
      setWorkspacePolicy,
      reloadResources: vi.fn(async () => ({ resources: [] }))
    } as unknown as AgentRuntime;

    await dispatchHostCommand(runtime, { type: "workspace.setTrust", payload: { trust: "trusted" } }, { sendEvent: vi.fn() } as never);
    expect(setWorkspacePolicy).toHaveBeenCalledWith("trusted", "balanced");
  });

  it("defaults approvalMode for runtime.initialize and workspace.open", async () => {
    const initializeRuntime = vi.fn(async () => ({}));
    for (const type of ["runtime.initialize", "workspace.open"] as const) {
      await dispatchHostCommand({} as AgentRuntime, { type, payload: { cwd: "/w", trust: "trusted" } }, { initializeRuntime } as never);
    }
    expect(initializeRuntime).toHaveBeenNthCalledWith(1, {}, { cwd: "/w", trust: "trusted", approvalMode: "balanced" });
    expect(initializeRuntime).toHaveBeenNthCalledWith(2, {}, { cwd: "/w", trust: "trusted", approvalMode: "balanced" });
  });
});
