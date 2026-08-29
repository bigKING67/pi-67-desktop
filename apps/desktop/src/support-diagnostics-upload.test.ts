import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA,
  SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
  SUPPORT_DIAGNOSTICS_UPLOAD_URL,
  type SupportDiagnosticsDocument
} from "@pi67/support-contract";
import { uploadSupportDiagnostics } from "./support-diagnostics-upload.js";

describe("support diagnostics upload", () => {
  it("posts one bounded fixed submission and verifies the exact receipt", async () => {
    const diagnostics = document();
    const serializedDiagnostics = `${JSON.stringify(diagnostics, null, 2)}\n`;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = requestBody(init);
      const submission = JSON.parse(body) as { reportId: string; diagnosticsSha256: string };
      return new Response(JSON.stringify({
        schema: SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
        reportId: submission.reportId,
        receivedAt: 2,
        sizeBytes: Buffer.byteLength(body, "utf8"),
        sha256: submission.diagnosticsSha256
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    });

    await expect(uploadSupportDiagnostics({
      diagnostics,
      serializedDiagnostics,
      applicationVersion: "0.1.0-alpha.37",
      fetcher,
      reportId: "PI67-A1B2C3D4E5F6",
      now: () => 1
    })).resolves.toEqual({
      schema: SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
      reportId: "PI67-A1B2C3D4E5F6",
      receivedAt: 2,
      sizeBytes: expect.any(Number),
      sha256: createHash("sha256").update(serializedDiagnostics).digest("hex")
    });
    expect(fetcher).toHaveBeenCalledWith(SUPPORT_DIAGNOSTICS_UPLOAD_URL, expect.objectContaining({
      method: "POST",
      redirect: "error",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        "User-Agent": "Pi-67-Desktop/0.1.0-alpha.37"
      })
    }));
    const body = JSON.parse(requestBody(fetcher.mock.calls[0]?.[1] ?? {})) as Record<string, unknown>;
    expect(body).toMatchObject({
      schema: "pi67-support-submission.v1",
      reportId: "PI67-A1B2C3D4E5F6",
      createdAt: 1,
      diagnostics
    });
  });

  it("rejects redirects, mismatched receipts, rate limits, timeouts, and oversized submissions", async () => {
    const diagnostics = document();
    const serializedDiagnostics = `${JSON.stringify(diagnostics, null, 2)}\n`;
    const redirected = response({ status: 201, url: "https://example.invalid/v1/diagnostics" });
    await expect(uploadSupportDiagnostics({
      diagnostics,
      serializedDiagnostics,
      applicationVersion: "0.1.0-alpha.37",
      fetcher: async () => redirected,
      reportId: "PI67-A1B2C3D4E5F6",
      now: () => 1
    })).rejects.toThrow("非预期地址");

    await expect(uploadSupportDiagnostics({
      diagnostics,
      serializedDiagnostics,
      applicationVersion: "0.1.0-alpha.37",
      fetcher: async (_url, init) => {
        const body = requestBody(init);
        return new Response(JSON.stringify({
          schema: SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
          reportId: "PI67-A1B2C3D4E5F6",
          receivedAt: 2,
          sizeBytes: Buffer.byteLength(body, "utf8"),
          sha256: "0".repeat(64)
        }), { status: 201 });
      },
      reportId: "PI67-A1B2C3D4E5F6",
      now: () => 1
    })).rejects.toThrow("回执与本次提交不一致");

    await expect(uploadSupportDiagnostics({
      diagnostics,
      serializedDiagnostics,
      applicationVersion: "0.1.0-alpha.37",
      fetcher: async () => new Response(null, { status: 429 }),
      reportId: "PI67-A1B2C3D4E5F6",
      now: () => 1
    })).rejects.toThrow("过于频繁");

    await expect(uploadSupportDiagnostics({
      diagnostics,
      serializedDiagnostics,
      applicationVersion: "0.1.0-alpha.37",
      fetcher: async () => { throw new DOMException("Aborted", "AbortError"); },
      reportId: "PI67-A1B2C3D4E5F6",
      now: () => 1
    })).rejects.toThrow("上传超时");

    await expect(uploadSupportDiagnostics({
      diagnostics,
      serializedDiagnostics,
      applicationVersion: "0.1.0-alpha.37",
      fetcher: async () => { throw new DOMException("Timed out", "TimeoutError"); },
      reportId: "PI67-A1B2C3D4E5F6",
      now: () => 1
    })).rejects.toThrow("上传超时");

    const oversized = document({ values: Array(130).fill("x".repeat(4_096)) });
    await expect(uploadSupportDiagnostics({
      diagnostics: oversized,
      serializedDiagnostics: `${JSON.stringify(oversized, null, 2)}\n`,
      applicationVersion: "0.1.0-alpha.37",
      fetcher: vi.fn(),
      reportId: "PI67-A1B2C3D4E5F6",
      now: () => 1
    })).rejects.toThrow("超过上传大小限制");
  });
});

function document(desktop: Record<string, unknown> = {}): SupportDiagnosticsDocument {
  return {
    schema: SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA,
    generatedAt: 1,
    application: {
      version: "0.1.0-alpha.37",
      platform: "darwin",
      architecture: "arm64",
      packaged: true
    },
    desktop,
    agentHost: {},
    piConfiguration: {},
    renderer: {},
    runtimeCollection: { status: "available" },
    runtime: {}
  };
}

function response(options: { status: number; url: string }): Response {
  const value = new Response("{}", { status: options.status });
  Object.defineProperty(value, "url", { value: options.url });
  return value;
}

function requestBody(init: RequestInit): string {
  if (typeof init.body !== "string") throw new Error("Expected a string request body.");
  return init.body;
}
