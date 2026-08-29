import { describe, expect, it } from "vitest";
import {
  SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA,
  SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES,
  SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
  SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA,
  isSupportDiagnosticsDocument,
  isSupportDiagnosticsSubmission,
  isSupportDiagnosticsUploadReceipt
} from "./support-diagnostics-contract.js";

describe("support diagnostics contract", () => {
  it("accepts one bounded redacted v5 submission and receipt", () => {
    const diagnostics = diagnosticDocument();
    expect(isSupportDiagnosticsDocument(diagnostics)).toBe(true);
    expect(isSupportDiagnosticsSubmission({
      schema: SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA,
      reportId: "PI67-A1B2C3D4E5F6",
      createdAt: 1,
      diagnosticsSha256: "a".repeat(64),
      diagnostics
    })).toBe(true);
    expect(isSupportDiagnosticsUploadReceipt({
      schema: SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
      reportId: "PI67-A1B2C3D4E5F6",
      receivedAt: 2,
      sizeBytes: 1_024,
      sha256: "a".repeat(64)
    })).toBe(true);
  });

  it("rejects unknown roots, Runtime mismatches, sensitive nested keys, and oversized receipts", () => {
    expect(isSupportDiagnosticsDocument({ ...diagnosticDocument(), prompt: "private" })).toBe(false);
    expect(isSupportDiagnosticsDocument({
      ...diagnosticDocument(),
      runtimeCollection: { status: "unavailable", failure: "connection-unavailable" },
      runtime: {}
    })).toBe(false);
    expect(isSupportDiagnosticsDocument({
      ...diagnosticDocument(),
      desktop: { path: "/private/workspace" }
    })).toBe(false);
    expect(isSupportDiagnosticsSubmission({
      schema: SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA,
      reportId: "caller-selected-path",
      createdAt: 1,
      diagnosticsSha256: "a".repeat(64),
      diagnostics: diagnosticDocument()
    })).toBe(false);
    expect(isSupportDiagnosticsUploadReceipt({
      schema: SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
      reportId: "PI67-A1B2C3D4E5F6",
      receivedAt: 2,
      sizeBytes: SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES + 1,
      sha256: "a".repeat(64)
    })).toBe(false);
  });
});

function diagnosticDocument() {
  return {
    schema: SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA,
    generatedAt: 1,
    application: {
      version: "0.1.0-alpha.37",
      platform: "darwin",
      architecture: "arm64",
      packaged: true
    },
    desktop: { previousRunExitStatus: "clean" },
    agentHost: { phase: "running" },
    piConfiguration: { files: [] },
    renderer: { activeRequestCount: 0 },
    runtimeCollection: { status: "available" },
    runtime: { generatedAt: 1 }
  };
}
