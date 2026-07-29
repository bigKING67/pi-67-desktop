import { describe, expect, it } from "vitest";
import { isPackageWorkerRequest, isPackageWorkerResponse } from "./package-worker-protocol.js";

describe("Package worker IPC contract", () => {
  it("accepts bounded package mutations and correlated responses", () => {
    const request = {
      type: "package-worker-request",
      requestId: "request-1",
      action: "install",
      cwd: "/workspace",
      agentDir: "/agent",
      projectTrusted: true,
      source: "npm:pi-example",
      scope: "project"
    };
    expect(isPackageWorkerRequest(request)).toBe(true);
    expect(isPackageWorkerResponse({
      type: "package-worker-response",
      requestId: "request-1",
      ok: true,
      result: { items: [], total: 0, changed: true }
    }, "request-1")).toBe(true);
    expect(isPackageWorkerResponse({
      type: "package-worker-response",
      requestId: "other-request",
      ok: true,
      result: {}
    }, "request-1")).toBe(false);
  });

  it("rejects missing mutation scope, oversized sources, and malformed errors", () => {
    expect(isPackageWorkerRequest({
      type: "package-worker-request",
      requestId: "request-1",
      action: "install",
      cwd: "/workspace",
      agentDir: "/agent",
      projectTrusted: true,
      source: "npm:pi-example"
    })).toBe(false);
    expect(isPackageWorkerRequest({
      type: "package-worker-request",
      requestId: "request-1",
      action: "install",
      cwd: "/workspace",
      agentDir: "/agent",
      projectTrusted: true,
      source: "x".repeat(4_097),
      scope: "global"
    })).toBe(false);
    expect(isPackageWorkerResponse({
      type: "package-worker-response",
      requestId: "request-1",
      ok: false,
      error: { code: "INTERNAL", message: "failed" }
    }, "request-1")).toBe(false);
  });
});
