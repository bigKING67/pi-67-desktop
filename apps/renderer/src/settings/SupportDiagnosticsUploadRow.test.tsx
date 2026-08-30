import { describe, expect, it } from "vitest";
import { formatSupportDiagnosticsLocator } from "./SupportDiagnosticsUploadRow.js";

describe("SupportDiagnosticsUploadRow locator", () => {
  it("copies bounded exact locator metadata without inventing an object key", () => {
    expect(formatSupportDiagnosticsLocator({
      schema: "pi67-support-receipt.v1",
      reportId: "PI67-A1B2C3D4E5F6",
      receivedAt: Date.UTC(2026, 7, 30, 1, 2, 3),
      sizeBytes: 4_096,
      sha256: "a".repeat(64),
      objectKey: "diagnostics/2026/08/30/PI67-A1B2C3D4E5F6.json"
    })).toBe([
      "Report ID: PI67-A1B2C3D4E5F6",
      "Received UTC: 2026-08-30T01:02:03.000Z",
      "Object key: diagnostics/2026/08/30/PI67-A1B2C3D4E5F6.json",
      "Size: 4096 bytes",
      `SHA-256: ${"a".repeat(64)}`
    ].join("\n"));

    const rollingReceipt = formatSupportDiagnosticsLocator({
      schema: "pi67-support-receipt.v1",
      reportId: "PI67-A1B2C3D4E5F6",
      receivedAt: Date.UTC(2026, 7, 30, 1, 2, 3),
      sizeBytes: 4_096,
      sha256: "a".repeat(64)
    });
    expect(rollingReceipt).not.toContain("Object key:");
  });
});
