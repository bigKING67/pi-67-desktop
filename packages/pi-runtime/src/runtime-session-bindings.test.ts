import { describe, expect, it, vi } from "vitest";
import type { RuntimeProjectionController } from "./runtime-projection-controller.js";
import { createRuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import { RuntimeSessionBindings } from "./runtime-session-bindings.js";
import { SessionExternalChangeGuard } from "./session-external-change-guard.js";

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
});

function createBindings(): RuntimeSessionBindings {
  return new RuntimeSessionBindings({
    cancelInteractiveRequests: vi.fn(),
    emit: vi.fn(),
    externalChangeGuard: new SessionExternalChangeGuard(),
    getAgentDir: () => "/tmp/pi67-agent",
    getRuntimeCredentialOverrides: () => createRuntimeCredentialOverrideStore(),
    getSafety: () => ({ cwd: "/tmp/pi67-workspace", trust: "unknown", approvalMode: "guided" }),
    getWorkspaceServices: () => undefined,
    projections: { reset: vi.fn() } as unknown as RuntimeProjectionController,
    rebindExtensionUi: vi.fn(async () => undefined),
    requestApproval: vi.fn(async () => false),
    setSessionCwd: vi.fn()
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
