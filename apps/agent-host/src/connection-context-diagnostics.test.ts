import type { ProtocolPort } from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import { HostConnectionContext } from "./connection-context.js";
import { HostDiagnosticEvidence } from "./host-diagnostic-evidence.js";
import { TEST_APP_CONTEXT } from "./protocol-test-fixtures.js";

class ThrowingPort implements ProtocolPort {
  postMessage(): void {
    throw new DOMException("private clone detail", "DataCloneError");
  }

  close(): void {}
}

describe("HostConnectionContext diagnostic evidence", () => {
  it("retains a classified asset response failure above the replaced Port without raw identifiers", () => {
    const evidence = new HostDiagnosticEvidence(() => 100);
    const connectionSequence = evidence.attach(6);
    const connection = new HostConnectionContext(
      new ThrowingPort(),
      { appInstanceId: "app-assets", hostInstanceId: "host-assets", hostEpoch: 6 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      () => undefined,
      () => undefined,
      2_048,
      256,
      { connectionSequence, record: (incident) => evidence.record(incident) }
    );
    const data = Uint8Array.from([1, 2, 3]).buffer;
    connection.beginResponse({
      requestId: "private-request-id",
      type: "asset.read",
      context: TEST_APP_CONTEXT
    });
    connection.sendSuccess("private-request-id", "asset.read", {
      assetId: "private-asset-id",
      mimeType: "image/png",
      byteLength: 3,
      offset: 0,
      data,
      done: true
    });

    evidence.attach(6);
    const snapshot = evidence.snapshot();
    expect(snapshot.incidents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        layer: "agent-host",
        phase: "response-post",
        outcome: "failed",
        command: "asset.read",
        errorClass: "DataCloneError",
        reason: "response-post-failed",
        connectionSequence,
        hostEpoch: 6,
        binaryBytes: 3
      }),
      expect.objectContaining({
        phase: "port-attach",
        connectionSequence: connectionSequence + 1,
        hostEpoch: 6
      })
    ]));
    expect(JSON.stringify(snapshot)).not.toContain("private-request-id");
    expect(JSON.stringify(snapshot)).not.toContain("private-asset-id");
    expect(JSON.stringify(snapshot)).not.toContain("private clone detail");
  });
});
