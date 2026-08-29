import { describe, expect, it, vi } from "vitest";
import {
  inspectRealUserRuntimeSurface,
  realUserLifecycleFailureKind
} from "./windows-real-user-failure-diagnostics.mjs";

describe("Windows real-user failure diagnostics", () => {
  it("reports bounded and redacted runtime failure diagnostics", async () => {
    const observation = {
      acknowledgementTimedOut: false,
      acknowledgementTimeoutCommand: null,
      catalogError: "C:\\private-root\\catalog failed",
      catalogLoading: "C:\\private-root\\catalog loading",
      errorNotificationCount: 1,
      providerConfigurationFailed: false,
      runtimePhase: "failed",
      runtimeStatus: "当前状态：C:\\private-root\\runtime failed",
      workspaceOpenFailed: false
    };
    const window = { evaluate: vi.fn(async () => observation) };

    await expect(inspectRealUserRuntimeSurface(window, "C:\\private-root")).resolves.toEqual({
      ...observation,
      catalogError: "<temporary-root>\\catalog failed",
      catalogLoading: "<temporary-root>\\catalog loading",
      runtimeStatus: "当前状态：<temporary-root>\\runtime failed"
    });
  });

  it("retains only an allowlisted acknowledgement command identity", async () => {
    const body = {
      innerText: "无法停止：Agent request acknowledgement timed out: operation.abort"
    };
    const runtime = {
      getAttribute: (name) => name === "data-runtime-phase"
        ? "ready"
        : name === "aria-label" ? "当前状态：Pi SDK 已就绪" : null
    };
    const workspaceGroup = {
      getAttribute: (name) => name === "data-catalog-error"
        ? "false"
        : name === "data-catalog-loading" ? "false" : null
    };
    vi.stubGlobal("document", {
      body,
      querySelector: (selector) => selector.startsWith('[aria-label^="当前状态："]')
        ? runtime
        : selector === '[data-testid="workspace-group"]' ? workspaceGroup : null,
      querySelectorAll: () => []
    });
    const window = { evaluate: vi.fn(async (inspect, allowlist) => inspect(allowlist)) };
    try {
      await expect(inspectRealUserRuntimeSurface(window, "C:\\private-root"))
        .resolves.toMatchObject({ acknowledgementTimeoutCommand: "operation.abort" });

      body.innerText = "Session 内容：Agent request acknowledgement timed out: private.prompt";
      await expect(inspectRealUserRuntimeSurface(window, "C:\\private-root"))
        .resolves.toMatchObject({ acknowledgementTimeoutCommand: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies failures without retaining arbitrary error text", () => {
    expect(realUserLifecycleFailureKind(new Error(
      "Windows real-user lifecycle exposed a raw acknowledgement timeout."
    ))).toBe("raw-acknowledgement-timeout");
    expect(realUserLifecycleFailureKind(new Error("secret prompt body"))).toBe("lifecycle-error");
    expect(realUserLifecycleFailureKind("secret prompt body")).toBe("unknown");
  });
});
