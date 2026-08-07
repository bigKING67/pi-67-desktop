import { describe, expect, it } from "vitest";
import {
  protocolDocumentationViolations,
  rendererSessionInstallationViolations,
  runningTaskDocumentationViolations
} from "./architecture-rules.mjs";

describe("renderer architecture rules", () => {
  it("rejects production Session snapshot replacement outside the installation owner", () => {
    expect(rendererSessionInstallationViolations(
      "apps/renderer/src/conversation/bypass.ts",
      "store.beginSnapshotReplacement(connection, snapshot, 3);"
    )).toEqual([
      "apps/renderer/src/conversation/bypass.ts: beginSnapshotReplacement is owned by apps/renderer/src/app/renderer-session-installation.ts"
    ]);
  });

  it("allows the installation owner and explicit test support", () => {
    for (const path of [
      "apps/renderer/src/app/renderer-session-installation.ts",
      "apps/renderer/src/session/session-projection-test-support.ts"
    ]) {
      expect(rendererSessionInstallationViolations(
        path,
        "store.commitSnapshotReplacement(connection, installation, snapshot);"
      )).toEqual([]);
    }
  });
});

describe("protocol documentation architecture rule", () => {
  it("accepts documentation that matches the source protocol version", () => {
    expect(protocolDocumentationViolations(
      "export const PROTOCOL_VERSION = 4 as const;",
      "所有 envelope 使用 `protocolVersion: 4`："
    )).toEqual([]);
  });

  it("rejects a stale documented protocol version", () => {
    expect(protocolDocumentationViolations(
      "export const PROTOCOL_VERSION = 4 as const;",
      "所有 envelope 使用 `protocolVersion: 3`："
    )).toEqual([
      "docs/architecture/processes-and-protocol.md: protocolVersion 3 does not match source 4"
    ]);
  });
});

describe("running Task documentation architecture rule", () => {
  const source = "export const MAX_RUNNING_TASKS = 8;";

  it("accepts every product authority document at the source limit", () => {
    expect(runningTaskDocumentationViolations(source, [
      { path: "README.md", source: "`MAX_RUNNING_TASKS = 8`" },
      { path: "PRODUCT.md", source: "`MAX_RUNNING_TASKS = 8`" },
      { path: "DESIGN.md", source: "`MAX_RUNNING_TASKS = 8`" }
    ])).toEqual([]);
  });

  it("rejects missing and stale declarations", () => {
    expect(runningTaskDocumentationViolations(source, [
      { path: "README.md", source: "no contract" },
      { path: "PRODUCT.md", source: "`MAX_RUNNING_TASKS = 4`" }
    ])).toEqual([
      "README.md: missing the canonical MAX_RUNNING_TASKS declaration",
      "PRODUCT.md: MAX_RUNNING_TASKS 4 does not match source 8"
    ]);
  });
});
