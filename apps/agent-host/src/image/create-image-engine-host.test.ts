import { describe, expect, it, vi } from "vitest";
import type { AgentCommand } from "@pi67/protocol";
import type { HostEventChannel } from "../host-event-channel.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";
import { createImageEngineHost } from "./create-image-engine-host.js";

describe("image engine host wiring", () => {
  it("refuses untrusted Workspaces before touching any file", async () => {
    const workspaces = { require: () => ({ canonicalCwd: "/never-read", initialization: { trust: "untrusted" } }) } as unknown as WorkspaceContextRegistry;
    const engine = createImageEngineHost(workspaces, { sendFor: vi.fn() } as unknown as HostEventChannel);
    await expect(engine.execute("w1", { type: "image.project.list", payload: {} } as AgentCommand<"image.project.list">))
      .rejects.toMatchObject({ code: "WORKSPACE_NOT_TRUSTED", recoverable: true });
  });

  it("emits events with Workspace scope", async () => {
    const sendFor = vi.fn();
    const workspaces = { require: () => ({ canonicalCwd: "/tmp/does-not-exist-image-host", initialization: { trust: "trusted" } }) } as unknown as WorkspaceContextRegistry;
    const engine = createImageEngineHost(workspaces, { sendFor } as unknown as HostEventChannel);
    expect((await engine.execute("w1", { type: "image.project.list", payload: {} } as AgentCommand<"image.project.list">)).projects).toEqual([]);
    const dependencies = (engine as unknown as { dependencies: { emit: (id: string, event: unknown) => void } }).dependencies;
    dependencies.emit("w1", { type: "image.job.changed", payload: {} });
    expect(sendFor).toHaveBeenCalledWith({ type: "image.job.changed", payload: {} }, { runtime: undefined, operations: undefined, context: { scope: "workspace", workspaceId: "w1" } });
  });
});
