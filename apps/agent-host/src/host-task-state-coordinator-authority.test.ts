import {
  COMMAND_CONTEXT_SCOPE_REQUIREMENTS,
  PROTOCOL_VERSION,
  type AgentCommandType,
  type RequestEnvelope
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { HostTaskStateCoordinator } from "./host-task-state-coordinator.js";
import { HostCommandError } from "./protocol-error.js";

const WORKSPACE_ID = "workspace-authority";
const LIFECYCLE_TYPES = new Set<AgentCommandType>([
  "workspace.register",
  "workspace.unregister"
]);

describe("HostTaskStateCoordinator Workspace authority", () => {
  it("uses the Protocol scope requirement as the App authority classification", () => {
    const fixture = coordinatorFixture();
    const appTypes = Object.entries(COMMAND_CONTEXT_SCOPE_REQUIREMENTS)
      .filter((entry): entry is [AgentCommandType, "app"] => entry[1] === "app")
      .map(([type]) => type);

    for (const type of appTypes) {
      expect(fixture.coordinator.authorizeRequestContext(appRequest(type))).toBeUndefined();
    }

    expect(fixture.workspaces.require).not.toHaveBeenCalled();
    expect(fixture.taskRuntimes.admit).not.toHaveBeenCalled();
    expect(fixture.taskRuntimes.assertSessionAuthority).not.toHaveBeenCalled();
  });

  it("uses the Protocol scope requirement as the Workspace authority classification", () => {
    const fixture = coordinatorFixture();
    const workspaceTypes = Object.entries(COMMAND_CONTEXT_SCOPE_REQUIREMENTS)
      .filter((entry): entry is [AgentCommandType, "workspace"] => entry[1] === "workspace")
      .map(([type]) => type);

    for (const type of workspaceTypes) {
      fixture.workspaces.require.mockClear();
      expect(fixture.coordinator.authorizeRequestContext(request(type))).toBeUndefined();
      if (LIFECYCLE_TYPES.has(type)) {
        expect(fixture.workspaces.require).not.toHaveBeenCalled();
      } else {
        expect(fixture.workspaces.require).toHaveBeenCalledOnce();
        expect(fixture.workspaces.require).toHaveBeenCalledWith(WORKSPACE_ID);
      }
    }

    expect(fixture.taskRuntimes.admit).not.toHaveBeenCalled();
    expect(fixture.taskRuntimes.assertSessionAuthority).not.toHaveBeenCalled();
  });

  it("fails closed for unregistered Workspaces and unclassified Workspace contexts", () => {
    const fixture = coordinatorFixture();
    fixture.workspaces.require.mockImplementation(() => {
      throw new HostCommandError("RUNTIME_NOT_READY", "Workspace missing.", true);
    });

    expect(() => fixture.coordinator.authorizeRequestContext(
      request("session.creation.resolve")
    )).toThrowError(expect.objectContaining({ code: "RUNTIME_NOT_READY" }));
    expect(() => fixture.coordinator.authorizeRequestContext(
      request("prompt.submit")
    )).toThrowError("Command requires Task authority: prompt.submit");
    expect(fixture.taskRuntimes.admit).not.toHaveBeenCalled();
  });
});

function request(type: AgentCommandType): RequestEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "request",
    requestId: `request-${type}`,
    hostEpoch: 1,
    context: { scope: "workspace", workspaceId: WORKSPACE_ID },
    type,
    payload: {}
  } as RequestEnvelope;
}

function appRequest(type: AgentCommandType): RequestEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "request",
    requestId: `request-${type}`,
    hostEpoch: 1,
    context: { scope: "app" },
    type,
    payload: {}
  } as RequestEnvelope;
}

function coordinatorFixture() {
  const taskRuntimes = {
    admit: vi.fn(),
    assertSessionAuthority: vi.fn(),
    values: vi.fn(() => [])
  };
  const workspaces = { require: vi.fn(() => ({})) };
  const coordinator = new HostTaskStateCoordinator(
    taskRuntimes as never,
    workspaces as never,
    {
      getHostEpoch: () => 1,
      sendTaskEvent: () => false
    }
  );
  return { coordinator, taskRuntimes, workspaces };
}
