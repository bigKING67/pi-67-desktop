import { describe, expect, it } from "vitest";
import {
  SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA,
  SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA_V5,
  SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES,
  SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
  SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA,
  isSupportDiagnosticsDocument,
  isSupportDiagnosticsSubmission,
  isSupportDiagnosticsUploadReceipt,
  type SupportDiagnosticsDocumentV6
} from "./support-diagnostics-contract.js";

describe("support diagnostics contract", () => {
  it("accepts one bounded redacted v6 submission and receipt", () => {
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
      sha256: "a".repeat(64),
      objectKey: "diagnostics/2026/08/30/PI67-A1B2C3D4E5F6.json"
    })).toBe(true);
  });

  it("keeps v5 diagnostic ingestion compatible during rollout", () => {
    expect(isSupportDiagnosticsDocument(diagnosticDocument(SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA_V5))).toBe(true);
  });

  it("keeps a full bounded v6 causal projection below the existing upload cap", () => {
    const document = diagnosticDocument() as SupportDiagnosticsDocumentV6;
    const actions = Array.from({ length: 16 }, (_, index) => ({
      sequence: index + 1,
      at: index + 1,
      action: "task.resume" as const,
      stage: "failed" as const
    }));
    const incidents = Array.from({ length: 32 }, (_, index) => ({
      sequence: index + 17,
      at: index + 17,
      layer: "renderer" as const,
      phase: "request" as const,
      outcome: "failed" as const,
      command: "provider.model-catalog.refresh",
      errorClass: "ProtocolRequestError" as const,
      reason: "request-failed" as const,
      connectionGeneration: Number.MAX_SAFE_INTEGER,
      hostEpoch: Number.MAX_SAFE_INTEGER,
      durationMs: Number.MAX_SAFE_INTEGER,
      binaryBytes: Number.MAX_SAFE_INTEGER
    }));
    document.causality = {
      renderer: {
        actions,
        actionsDroppedCount: Number.MAX_SAFE_INTEGER,
        incidents,
        incidentsDroppedCount: Number.MAX_SAFE_INTEGER
      },
      agentHost: {
        incidents: incidents.map((incident) => ({ ...incident, layer: "agent-host" })),
        incidentsDroppedCount: Number.MAX_SAFE_INTEGER
      }
    };
    expect(isSupportDiagnosticsDocument(document)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(document)).byteLength).toBeLessThan(
      SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES
    );
  });

  it("rejects unknown roots, Runtime mismatches, sensitive nested keys, and oversized receipts", () => {
    const v6 = diagnosticDocument();
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
    expect(isSupportDiagnosticsDocument({
      ...v6,
      causality: {
        ...v6.causality,
        renderer: {
          ...v6.causality!.renderer,
          incidents: [{
            sequence: 1,
            at: 1,
            layer: "renderer",
            phase: "request",
            outcome: "failed",
            command: "asset.read",
            message: "private error"
          }]
        }
      }
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

function diagnosticDocument(schema: typeof SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA | typeof SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA_V5 = SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA) {
  const v6 = schema === SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA;
  return {
    schema,
    generatedAt: 1,
    application: {
      version: "0.1.0-alpha.37",
      platform: "darwin",
      architecture: "arm64",
      packaged: true,
      ...(v6 ? { protocolRevision: "a".repeat(64) } : {})
    },
    desktop: { previousRunExitStatus: "clean" },
    agentHost: { phase: "running" },
    piConfiguration: { files: [] },
    renderer: { activeRequestCount: 0 },
    runtimeCollection: { status: "available" },
    runtime: { generatedAt: 1 },
    ...(v6 ? {
      causality: {
        renderer: {
          actions: [{ sequence: 1, at: 1, action: "task.resume", stage: "started" }],
          actionsDroppedCount: 0,
          incidents: [{
            sequence: 2,
            at: 2,
            layer: "renderer",
            phase: "request",
            outcome: "failed",
            command: "asset.read",
            errorClass: "DataCloneError",
            reason: "request-failed"
          }],
          incidentsDroppedCount: 0
        }
      }
    } : {})
  };
}
