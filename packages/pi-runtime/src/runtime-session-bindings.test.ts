import { RuntimeError, type PlanImplementationRequestLineage } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeProjectionController } from "./runtime-projection-controller.js";
import { createRuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import { RuntimeSessionBindings } from "./runtime-session-bindings.js";
import { SessionExternalChangeGuard } from "./session-external-change-guard.js";
import type { PiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";
import { NativeSubagentCoordinator } from "./native-subagent-coordinator.js";
import { NativeSubagentAdmission } from "./native-subagent-admission.js";

describe("RuntimeSessionBindings", () => {
  it("owns the structured not-ready boundary", () => {
    const bindings = createBindings();

    expect(captureError(() => bindings.requireSession())).toMatchObject({
      code: "RUNTIME_NOT_READY",
      recoverable: true
    });
  });

  it("admits only one session transition and releases ownership after completion", async () => {
    const bindings = createBindings();
    let release: (() => void) | undefined;
    const active = bindings.runTransition(() => new Promise<string>((resolve) => {
      release = () => resolve("completed");
    }));

    await expect(bindings.runTransition(async () => "competing")).rejects.toMatchObject({
      code: "BUSY",
      details: { retryable: true }
    });
    release?.();
    await expect(active).resolves.toBe("completed");
    await expect(bindings.runTransition(async () => "next")).resolves.toBe("next");
  });

  it("releases transition ownership after a failed operation", async () => {
    const bindings = createBindings();

    await expect(bindings.runTransition(async () => {
      throw new Error("transition failed");
    })).rejects.toThrow("transition failed");
    await expect(bindings.runTransition(async () => "recovered")).resolves.toBe("recovered");
  });

  it("preserves the bounded Task model runtime failure before creating a Pi Session", async () => {
    const createModelRuntime = vi.fn().mockRejectedValue(new RuntimeError(
      "RUNTIME_NOT_READY",
      "Pi Task model runtime did not initialize within the bounded startup budget.",
      { recoverable: true, details: { stage: "session-model-runtime", waitMs: 10 } }
    ));
    const bindings = createBindings(() => ({
      assertCompatible: vi.fn(),
      configurationService: { createModelRuntime },
      packageTrustRegistry: {
        refresh: vi.fn(async () => undefined),
        runtimePackageAllowed: vi.fn(() => false)
      }
    } as unknown as PiWorkspaceRuntimeServices));

    await expect(bindings.createInitial("/tmp/pi67-workspace")).rejects.toMatchObject({
      code: "RUNTIME_NOT_READY",
      recoverable: true,
      details: { stage: "session-model-runtime", waitMs: 10 }
    });
    expect(createModelRuntime).toHaveBeenCalledOnce();
  });

  it("starts Task model runtime and Package trust preparation concurrently", async () => {
    let rejectModelRuntime!: (reason: Error) => void;
    let releasePackageTrust!: () => void;
    const createModelRuntime = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectModelRuntime = reject;
    }));
    const refresh = vi.fn(() => new Promise<void>((resolve) => {
      releasePackageTrust = resolve;
    }));
    const bindings = createBindings(() => ({
      assertCompatible: vi.fn(),
      configurationService: { createModelRuntime },
      packageTrustRegistry: {
        refresh,
        runtimePackageAllowed: vi.fn(() => false)
      }
    } as unknown as PiWorkspaceRuntimeServices));

    const creation = bindings.createInitial("/tmp/pi67-workspace");
    await vi.waitFor(() => {
      expect(createModelRuntime).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
    });
    const failure = new Error("model runtime stopped after concurrent preparation");
    rejectModelRuntime(failure);
    releasePackageTrust();

    await expect(creation).rejects.toBe(failure);
  });

  it("fails closed when Plan lineage no longer matches the bound Session identity", async () => {
    const bindings = createBindings();
    const internals = bindings as unknown as {
      activeRuntime: { session: { sessionId: string } };
      activeSessionFileIdentity: string;
      generation: number;
      planMode: { implementPlan(planId: string, lineage: PlanImplementationRequestLineage): Promise<void> };
    };
    internals.activeRuntime = { session: { sessionId: "session-plan" } };
    internals.activeSessionFileIdentity = "session-file-plan";
    internals.generation = 4;
    const implementPlan = vi.spyOn(internals.planMode, "implementPlan").mockResolvedValue(undefined);
    const lineage: PlanImplementationRequestLineage = {
      submissionId: "submission-plan",
      operationId: "operation-plan",
      hostEpoch: 9,
      sessionId: "session-plan",
      sessionFileIdentity: "session-file-plan",
      sessionGeneration: 4
    };

    await expect(bindings.implementPlan("plan-1", lineage)).resolves.toBeUndefined();
    expect(implementPlan).toHaveBeenCalledWith("plan-1", lineage);

    expect(() => bindings.implementPlan("plan-1", {
      ...lineage,
      sessionFileIdentity: "session-file-stale"
    })).toThrow("no longer belongs to the active Pi Session");
    expect(() => bindings.implementPlan("plan-1", {
      ...lineage,
      sessionGeneration: 5
    })).toThrow("no longer belongs to the active Pi Session");
    expect(implementPlan).toHaveBeenCalledOnce();
  });
});

function createBindings(
  getWorkspaceServices: () => PiWorkspaceRuntimeServices | undefined = () => undefined
): RuntimeSessionBindings {
  return new RuntimeSessionBindings({
    cancelInteractiveRequests: vi.fn(),
    emit: vi.fn(),
    externalChangeGuard: new SessionExternalChangeGuard(),
    getAgentDir: () => "/tmp/pi67-agent",
    getRuntimeCredentialOverrides: () => createRuntimeCredentialOverrideStore(),
    getSafety: () => ({
      cwd: "/tmp/pi67-workspace",
      trust: "unknown",
      approvalMode: "guided",
      taskToolMode: "ask"
    }),
    getWorkspaceServices,
    getPromptAttachmentAccess: () => undefined,
    projections: { reset: vi.fn() } as unknown as RuntimeProjectionController,
    rebindExtensionUi: vi.fn(async () => undefined),
    bindChildExtensionUi: vi.fn(async () => undefined),
    requestApproval: vi.fn(async () => ({ status: "denied" as const })),
    recordToolAuthorization: vi.fn(),
    setSessionCwd: vi.fn(),
    sharedExperienceAccess: undefined,
    subagents: new NativeSubagentCoordinator({
      admission: new NativeSubagentAdmission(),
      parentKey: "test-parent",
      getAgentDir: () => "/tmp/pi67-agent",
      createSession: async () => { throw new Error("unexpected child session"); },
      emit: vi.fn()
    })
  });
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to throw.");
}
