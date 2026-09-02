import type { PiProviderConfigurationSnapshot, WorkspaceDescriptor } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { loadNewSessionRuntimeConfiguration } from "./new-session-runtime-controller.js";

vi.mock("../connection/connection-recovery.js", () => ({
  ensureAgentConnection: vi.fn(async () => ({ hostEpoch: 1 }))
}));
vi.mock("../workbench/workspace-host-registration-controller.js", () => ({
  registerRendererWorkspaceWithHost: vi.fn(async () => true)
}));

const ensureConnection = vi.mocked(ensureAgentConnection);
const registerWorkspace = vi.mocked(registerRendererWorkspaceWithHost);
const request = vi.spyOn(agentConnectionController, "request");

describe("new Session runtime configuration", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
    ensureConnection.mockClear();
    registerWorkspace.mockClear();
    request.mockReset().mockResolvedValue(snapshot() as never);
  });

  it("reads the trusted Workspace projection without creating a Session", async () => {
    const workspace = trustedWorkspace();
    rendererWorkbenchStore.getState().registerWorkspace(workspace);

    await expect(loadNewSessionRuntimeConfiguration(workspace.id)).resolves.toEqual(snapshot());

    expect(ensureConnection).toHaveBeenCalledOnce();
    expect(registerWorkspace).toHaveBeenCalledWith(workspace, { queryCatalog: false });
    expect(request).toHaveBeenCalledWith(
      "provider.projectConfiguration.get",
      {},
      [],
      expect.objectContaining({ context: { scope: "workspace", workspaceId: workspace.id } })
    );
  });

  it("falls back to the app projection for an untrusted Workspace", async () => {
    rendererWorkbenchStore.getState().registerWorkspace({
      ...trustedWorkspace(),
      trust: "untrusted",
      trustProvenance: "restored"
    });

    await expect(loadNewSessionRuntimeConfiguration("workspace-1")).resolves.toEqual(snapshot());

    expect(registerWorkspace).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      "provider.configuration.get",
      {},
      [],
      expect.objectContaining({ context: { scope: "app" } })
    );
  });
});

function trustedWorkspace(): WorkspaceDescriptor {
  return {
    id: "workspace-1",
    displayName: "Workspace",
    identity: { canonicalPath: "/workspace", assurance: "path-only" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

function snapshot(): PiProviderConfigurationSnapshot {
  return {
    revision: "a".repeat(64),
    syncState: "current",
    updatedAt: 1,
    providers: [],
    credentials: [],
    defaults: { projectTrusted: true },
    vision: { disabledByProject: false, projectTrusted: true },
    files: [],
    diagnostics: []
  };
}
