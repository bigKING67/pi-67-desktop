import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA,
  SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA,
  SUPPORT_DIAGNOSTICS_UPLOAD_URL,
  type SupportDiagnosticsSubmission
} from "@pi67/support-contract";
import {
  handleSupportDiagnosticsRequest,
  SupportDiagnosticsAdmission,
  type SupportIngestEnvironment
} from "./index.js";

describe("support diagnostics ingest", () => {
  it("stores one fixed private object and returns an idempotent receipt", async () => {
    const now = Date.UTC(2026, 7, 29, 6, 0, 0);
    const submission = fixtureSubmission(now);
    const body = JSON.stringify(submission);
    const objects = new Map<string, { value: string; customMetadata: Record<string, string> }>();
    const environment = fixtureEnvironment(objects);

    const first = await handleSupportDiagnosticsRequest(request(body), environment, now);
    expect(first.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({
      schema: "pi67-support-receipt.v1",
      reportId: submission.reportId,
      sizeBytes: new TextEncoder().encode(body).byteLength,
      sha256: submission.diagnosticsSha256
    });
    expect([...objects.keys()]).toEqual([
      "diagnostics/2026/08/29/PI67-A1B2C3D4E5F6.json"
    ]);
    expect(objects.get("diagnostics/2026/08/29/PI67-A1B2C3D4E5F6.json")).toMatchObject({
      value: body,
      customMetadata: {
        reportId: submission.reportId,
        retentionDays: "30",
        sha256: submission.diagnosticsSha256
      }
    });

    const duplicate = await handleSupportDiagnosticsRequest(request(body), environment, now + 1_000);
    expect(duplicate.status).toBe(200);
    expect(environment.SUPPORT_DIAGNOSTICS_BUCKET.put).toHaveBeenCalledTimes(1);
    for (const call of vi.mocked(environment.SUPPORT_DIAGNOSTICS_BUCKET.put).mock.calls) {
      expect(call[2].onlyIf.get("If-None-Match")).toBe("*");
    }
  });

  it("uses one Durable Object to admit at most one new report per UTC minute", async () => {
    const now = Date.UTC(2026, 7, 29, 6, 0, 0);
    const firstSubmission = fixtureSubmission(now);
    const secondSubmission = {
      ...fixtureSubmission(now + 1_000),
      reportId: "PI67-B1C2D3E4F5A6"
    };
    const objects = new Map<string, { value: string; customMetadata: Record<string, string> }>();
    const environment = fixtureEnvironment(objects);

    const first = await handleSupportDiagnosticsRequest(
      request(JSON.stringify(firstSubmission)),
      environment,
      now
    );
    const blocked = await handleSupportDiagnosticsRequest(
      request(JSON.stringify(secondSubmission)),
      environment,
      now + 1_000
    );

    expect(first.status).toBe(201);
    expect(blocked.status).toBe(429);
    expect([...objects.keys()]).toEqual([
      "diagnostics/2026/08/29/PI67-A1B2C3D4E5F6.json"
    ]);
  });

  it("rejects the wrong boundary, rate limits, stale time, invalid checksum, and sensitive fields", async () => {
    const now = Date.UTC(2026, 7, 29, 6, 0, 0);
    const submission = fixtureSubmission(now);
    const environment = fixtureEnvironment(new Map());
    const wrongPath = await handleSupportDiagnosticsRequest(
      new Request("https://support.52671314.xyz/v1/other", { method: "POST", body: "{}" }),
      environment,
      now
    );
    expect(wrongPath.status).toBe(404);

    const wrongMethod = await handleSupportDiagnosticsRequest(
      new Request(SUPPORT_DIAGNOSTICS_UPLOAD_URL, { method: "GET" }),
      environment,
      now
    );
    expect(wrongMethod.status).toBe(405);

    environment.SUPPORT_DIAGNOSTICS_ADMISSION = fixtureAdmissionNamespace(false);
    const limited = await handleSupportDiagnosticsRequest(request(JSON.stringify(submission)), environment, now);
    expect(limited.status).toBe(429);

    const normalEnvironment = fixtureEnvironment(new Map());
    const stale = await handleSupportDiagnosticsRequest(
      request(JSON.stringify({ ...submission, createdAt: now - 11 * 60_000 })),
      normalEnvironment,
      now
    );
    expect(stale.status).toBe(400);

    const checksum = await handleSupportDiagnosticsRequest(
      request(JSON.stringify({ ...submission, diagnosticsSha256: "0".repeat(64) })),
      normalEnvironment,
      now
    );
    expect(checksum.status).toBe(400);

    const sensitive = fixtureSubmission(now);
    sensitive.diagnostics.desktop = { path: "/private/workspace" };
    const rejected = await handleSupportDiagnosticsRequest(
      request(JSON.stringify(sensitive)),
      normalEnvironment,
      now
    );
    expect(rejected.status).toBe(400);
    expect(normalEnvironment.SUPPORT_DIAGNOSTICS_BUCKET.put).not.toHaveBeenCalled();
  });

  it("rejects a report-ID collision instead of overwriting stored bytes", async () => {
    const now = Date.UTC(2026, 7, 29, 6, 0, 0);
    const submission = fixtureSubmission(now);
    const body = JSON.stringify(submission);
    const objects = new Map([[
      "diagnostics/2026/08/29/PI67-A1B2C3D4E5F6.json",
      {
        value: "different",
        customMetadata: {
          reportId: submission.reportId,
          receivedAt: String(now),
          retentionDays: "30",
          sha256: "0".repeat(64),
          sizeBytes: "9"
        }
      }
    ]]);
    const environment = fixtureEnvironment(objects);

    const response = await handleSupportDiagnosticsRequest(request(body), environment, now);
    expect(response.status).toBe(409);
    expect(environment.SUPPORT_DIAGNOSTICS_BUCKET.put).not.toHaveBeenCalled();
  });
});

function fixtureSubmission(createdAt: number): SupportDiagnosticsSubmission {
  const diagnostics: SupportDiagnosticsSubmission["diagnostics"] = {
    schema: SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA,
    generatedAt: createdAt,
    application: {
      version: "0.1.0-alpha.37",
      platform: "darwin",
      architecture: "arm64",
      packaged: true
    },
    desktop: {},
    agentHost: {},
    piConfiguration: {},
    renderer: {},
    runtimeCollection: { status: "available" },
    runtime: {}
  };
  return {
    schema: SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA,
    reportId: "PI67-A1B2C3D4E5F6",
    createdAt,
    diagnosticsSha256: createHash("sha256")
      .update(`${JSON.stringify(diagnostics, null, 2)}\n`)
      .digest("hex"),
    diagnostics
  };
}

function request(body: string): Request {
  return new Request(SUPPORT_DIAGNOSTICS_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
}

function fixtureEnvironment(
  objects: Map<string, { value: string; customMetadata: Record<string, string> }>
): SupportIngestEnvironment {
  return {
    SUPPORT_DIAGNOSTICS_ADMISSION: fixtureAdmissionNamespace(),
    SUPPORT_DIAGNOSTICS_BUCKET: {
      head: vi.fn(async (key: string) => {
        const object = objects.get(key);
        return object ? { key, customMetadata: object.customMetadata } : null;
      }),
      put: vi.fn(async (key, value, options) => {
        if (objects.has(key)) return null;
        objects.set(key, { value, customMetadata: options.customMetadata });
        return { key, customMetadata: options.customMetadata };
      })
    }
  };
}

function fixtureAdmissionNamespace(admit = true): SupportIngestEnvironment["SUPPORT_DIAGNOSTICS_ADMISSION"] {
  const values = new Map<string, unknown>();
  const admission = new SupportDiagnosticsAdmission({
    storage: {
      transaction: async (closure) => closure({
        get: async <T>(key: string) => values.get(key) as T | undefined,
        put: async <T>(key: string, value: T) => {
          values.set(key, value);
        }
      })
    }
  });
  return {
    idFromName: () => ({}),
    get: () => ({
      fetch: admit
        ? (request) => admission.fetch(request)
        : async () => new Response(null, { status: 429 })
    })
  };
}
