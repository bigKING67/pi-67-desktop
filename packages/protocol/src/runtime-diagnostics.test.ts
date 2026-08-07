import { describe, expect, it } from "vitest";
import { isRuntimeDiagnostics } from "./runtime-diagnostics.js";

const diagnostics = {
  generatedAt: 1,
  application: "π",
  piSdkVersion: "0.81.1",
  platform: "darwin",
  architecture: "arm64",
  node: "24.18.0",
  workspace: {
    pathHash: "a".repeat(64),
    pathKind: "posix"
  },
  sessionConfigured: true,
  sessionFileConfigured: true,
  model: "openai/gpt-test",
  extensionCount: 0,
  extensionErrors: [],
  host: {
    hostEpoch: 4,
    taskCount: 1,
    liveRuntimeCount: 1,
    activeOperationCount: 0,
    writerLeases: { activeCount: 1, pendingCount: 0, compromised: false },
    workspaces: [],
    workspacesTruncated: false
  }
} as const;

describe("runtime diagnostics boundary", () => {
  it("accepts the bounded redacted diagnostics projection", () => {
    expect(isRuntimeDiagnostics(diagnostics)).toBe(true);
  });

  it("rejects raw paths, unknown fields, and malformed hashes", () => {
    expect(isRuntimeDiagnostics({ ...diagnostics, cwd: "/private/workspace" })).toBe(false);
    expect(isRuntimeDiagnostics({
      ...diagnostics,
      workspace: { pathHash: "short", pathKind: "posix" }
    })).toBe(false);
    expect(isRuntimeDiagnostics({
      ...diagnostics,
      extensionErrors: [{ sourceHash: "b".repeat(64), errorClass: "contains spaces" }]
    })).toBe(false);
  });
});
