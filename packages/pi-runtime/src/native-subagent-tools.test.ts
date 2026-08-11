import { describe, expect, it, vi } from "vitest";
import type { NativeSubagentView } from "@pi67/domain";
import { createNativeSubagentTools, type NativeSubagentOperations } from "./native-subagent-tools.js";

describe("native subagent tools", () => {
  it("does not admit Browser Profile fields into spawn", async () => {
    const fixture = operations();
    const [tool] = createNativeSubagentTools(fixture.value);
    expect(tool?.parameters).toMatchObject({ additionalProperties: false });
    await expect(tool?.execute("call", {
      action: "spawn",
      task: "inspect",
      profile: "Default"
    }, undefined, undefined, undefined as never)).rejects.toThrow(/Unknown native subagent spawn field: profile/u);
    await expect(tool?.execute("call", {
      action: "spawn",
      task: "inspect",
      browser_instance_id: "browser-a"
    }, undefined, undefined, undefined as never)).rejects.toThrow(/browser_instance_id/u);
  });

  it("passes parent child lineage to nested spawns", async () => {
    const fixture = operations();
    const [tool] = createNativeSubagentTools(fixture.value, { parentChildId: "parent-child", depth: 1 });
    await tool?.execute("call", {
      action: "spawn",
      task: "review",
      role: "reviewer",
      mode: "background"
    }, undefined, undefined, undefined as never);
    expect(fixture.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ task: "review", role: "reviewer", mode: "background" }),
      "parent-child",
      1
    );
  });

  it("waits only for foreground children in a mixed spawn batch", async () => {
    const fixture = operations();
    const [tool] = createNativeSubagentTools(fixture.value);
    await tool?.execute("call", {
      action: "spawn",
      tasks: [
        { task: "foreground", mode: "foreground" },
        { task: "background", mode: "background" }
      ]
    }, undefined, undefined, undefined as never);
    expect(fixture.wait).toHaveBeenCalledWith(["run-1"], "all", 300_000);
  });
});

function operations() {
  let sequence = 0;
  const spawn = vi.fn(async () => view(++sequence));
  const wait = vi.fn(async (ids: readonly string[]) => ({
    items: ids.map((id) => view(Number(id.split("-")[1] ?? 1), "completed")),
    timedOut: false
  }));
  const value: NativeSubagentOperations = {
    spawn,
    list: () => [],
    status: () => view(1),
    steer: async () => view(1),
    stop: async () => view(1, "cancelled"),
    resume: async () => view(1),
    wait
  };
  return { value, spawn, wait };
}

function view(index: number, state: NativeSubagentView["state"] = "running"): NativeSubagentView {
  return {
    runId: `run-${index}`,
    childId: `child-${index}`,
    activationId: `activation-${index}`,
    depth: 1,
    role: "general",
    state,
    mode: "background",
    context: "fresh",
    isolation: "shared",
    updatedAt: 1
  };
}
