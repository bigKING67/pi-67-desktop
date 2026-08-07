import type { RuntimeCredentialOverrideStore } from "@pi67/pi-runtime";
import type { AgentCommand, WorkspaceProtocolContext } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import type { HostEventChannel } from "./host-event-channel.js";
import { SessionWriterLeaseRegistry } from "./session-writer-lease-registry.js";
import type { TaskRuntimeRegistry } from "./task-runtime-registry.js";
import { WorkspaceCommandRouter } from "./workspace-command-router.js";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";

const WORKSPACE: WorkspaceProtocolContext = { scope: "workspace", workspaceId: "workspace-a" };

describe("WorkspaceCommandRouter shutdown", () => {
  it("waits for an admitted Workspace mutation before Host lease cleanup can continue", async () => {
    let finishMutation!: () => void;
    const set = vi.fn(() => new Promise<void>((resolve) => { finishMutation = resolve; }));
    const workspaces = {
      setEventSink: vi.fn(),
      require: vi.fn(() => ({
        workspaceServices: {
          providerCatalog: { list: async () => [] }
        }
      }))
    } as unknown as WorkspaceContextRegistry;
    const overrides = { set } as unknown as RuntimeCredentialOverrideStore;
    const router = new WorkspaceCommandRouter(
      workspaces,
      {} as TaskRuntimeRegistry,
      overrides,
      { sendFor: vi.fn() } as unknown as HostEventChannel,
      new SessionWriterLeaseRegistry()
    );
    const command: AgentCommand<"provider.setRuntimeKey"> = {
      type: "provider.setRuntimeKey",
      payload: { provider: "provider-a", apiKey: "write-only-fixture" }
    };
    const mutation = router.dispatchProvider(WORKSPACE, command, "mutation-a");
    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());

    let shutdownSettled = false;
    const shutdown = router.shutdown().then(() => { shutdownSettled = true; });
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    finishMutation();
    await expect(mutation).resolves.toEqual([]);
    await shutdown;
    expect(shutdownSettled).toBe(true);
  });
});
