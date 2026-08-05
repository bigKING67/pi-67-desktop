import { describe, expect, it } from "vitest";
import {
  protocolDocumentationViolations,
  rendererSessionInstallationViolations
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
      "export const PROTOCOL_VERSION = 3 as const;",
      "所有 envelope 使用 `protocolVersion: 3`："
    )).toEqual([]);
  });

  it("rejects a stale documented protocol version", () => {
    expect(protocolDocumentationViolations(
      "export const PROTOCOL_VERSION = 3 as const;",
      "所有 envelope 使用 `protocolVersion: 2`："
    )).toEqual([
      "docs/architecture/processes-and-protocol.md: protocolVersion 2 does not match source 3"
    ]);
  });
});
