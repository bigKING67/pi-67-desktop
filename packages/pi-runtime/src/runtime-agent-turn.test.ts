import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeAgentTurnControls } from "./runtime-agent-turn.js";
import { RuntimeToolSafetyController } from "./runtime-tool-safety-controller.js";
import { safetyHandler } from "./safety-extension-test-fixture.js";

describe("runtime agent turn controls", () => {
  it("removes every active tool and makes the safety policy block any tool call that still arrives", async () => {
    const session = { setActiveToolsByName: vi.fn(), getLastAssistantText: vi.fn(() => "回复") };
    const safety = new RuntimeToolSafetyController();
    safety.initialize("/workspace", "trusted");
    safety.setTaskToolMode("yolo");
    const controls = createRuntimeAgentTurnControls(() => session as unknown as AgentSession, safety);
    controls.disableAllTools();
    expect(session.setActiveToolsByName).toHaveBeenCalledWith([]);
    expect(controls.lastAssistantText()).toBe("回复");
    const requestApproval = vi.fn();
    const handler = safetyHandler(safety.policy, requestApproval);
    await expect(handler({ toolCallId: "t1", toolName: "read", input: { path: "README.md" } }, { hasUI: true, signal: new AbortController().signal }))
      .resolves.toMatchObject({ block: true, reason: expect.stringContaining("AGENT_TURN_NO_TOOLS") });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("stays disabled across trust changes for the same Session", () => {
    const safety = new RuntimeToolSafetyController();
    safety.initialize("/workspace", "trusted");
    safety.disableAllTools();
    safety.setWorkspacePolicy("untrusted");
    safety.setCwd("/elsewhere");
    expect(safety.policy.toolsDisabled).toBe(true);
  });
});
