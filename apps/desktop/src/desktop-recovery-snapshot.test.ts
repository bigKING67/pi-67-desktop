import { describe, expect, it } from "vitest";
import { workbenchDescriptorFixture } from "./workbench-state-test-fixture.js";
import { createEmptyWorkbenchState } from "./workbench-state.js";
import { createDesktopRecoverySnapshot, previousRunExitStatus } from "./desktop-recovery-snapshot.js";

describe("desktop recovery snapshot", () => {
  it("projects bounded Workspace, creation, and attachment facts without paths", () => {
    const available = workbenchDescriptorFixture("workspace-a", "/private/work/a");
    const changed = {
      ...workbenchDescriptorFixture("workspace-b", "/private/work/b"),
      trust: "unknown" as const,
      trustProvenance: "identity-changed" as const,
      availability: "identity-changed" as const,
      identity: {
        canonicalPath: "/private/work/b",
        assurance: "path-only" as const
      }
    };
    const state = {
      ...createEmptyWorkbenchState(),
      workspaces: [available, changed],
      workspaceOrder: [available.id, changed.id],
      sessionCreationRecovery: [{
        taskId: "task-pending",
        workspaceId: available.id,
        creationId: "creation-pending",
        taskGeneration: 1
      }]
    };

    const snapshot = createDesktopRecoverySnapshot(state, "unclean", {
      draftCount: 2,
      claimedCount: 1,
      invalidEntryCount: 0,
      truncated: false
    }, 42);

    expect(snapshot).toEqual({
      generatedAt: 42,
      previousRunExitStatus: "unclean",
      workspaces: {
        total: 2,
        available: 1,
        missing: 0,
        identityChanged: 1,
        needsConfirmation: 0,
        unavailable: 0,
        trusted: 1,
        trustUnknown: 1,
        pathOnlyIdentity: 1
      },
      pendingSessionCreations: 1,
      attachmentStaging: {
        draftCount: 2,
        claimedCount: 1,
        invalidEntryCount: 0,
        truncated: false
      }
    });
    expect(JSON.stringify(snapshot)).not.toContain("/private/work");
  });

  it("distinguishes first launch, clean exit, unclean exit, and corrupt state", () => {
    const state = createEmptyWorkbenchState();
    expect(previousRunExitStatus({ state, recovery: { kind: "initialized" } })).toBe("not-run");
    expect(previousRunExitStatus({ state: { ...state, cleanExit: true } })).toBe("clean");
    expect(previousRunExitStatus({ state })).toBe("unclean");
    expect(previousRunExitStatus({ state, recovery: { kind: "corrupt-reset" } })).toBe("unknown");
  });
});
