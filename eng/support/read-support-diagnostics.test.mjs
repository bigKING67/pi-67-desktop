import { createHash } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  analyzeSupportDiagnostics,
  loadSupportR2Credentials,
  readSupportDiagnostics,
  supportDiagnosticsObjectKey
} from "./read-support-diagnostics.mjs";

describe("support diagnostics exact R2 reader", () => {
  it("performs one exact GetObject and classifies a general causal chain", async () => {
    const submission = fixtureSubmission();
    const body = JSON.stringify(submission);
    const send = vi.fn(async (command) => {
      expect(command.input).toEqual({
        Bucket: "pi67-support-diagnostics",
        Key: "diagnostics/2026/08/30/PI67-A1B2C3D4E5F6.json"
      });
      return { ContentLength: Buffer.byteLength(body), Body: asyncBody(body) };
    });

    const result = await readSupportDiagnostics({
      reportId: submission.reportId,
      date: "2026-08-30",
      client: { send }
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.analysis.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "HOST_RESPONSE_POST_FAILED" }),
      expect.objectContaining({ rule: "FIRST_PARTY_ACTION_FAILED" })
    ]));
    expect(JSON.stringify(result)).not.toContain("private prompt");
  });

  it("rejects malformed locators, oversized objects, and checksum drift", async () => {
    expect(() => supportDiagnosticsObjectKey("bad", "2026-08-30")).toThrow("report ID");
    expect(() => supportDiagnosticsObjectKey("PI67-A1B2C3D4E5F6", "2026-13-40")).toThrow("valid UTC");

    await expect(readSupportDiagnostics({
      reportId: "PI67-A1B2C3D4E5F6",
      date: "2026-08-30",
      client: { send: async () => ({ ContentLength: 65_537, Body: asyncBody("{}") }) }
    })).rejects.toThrow("64 KiB");

    const submission = fixtureSubmission();
    submission.diagnosticsSha256 = "0".repeat(64);
    const body = JSON.stringify(submission);
    await expect(readSupportDiagnostics({
      reportId: submission.reportId,
      date: "2026-08-30",
      client: { send: async () => ({ ContentLength: body.length, Body: asyncBody(body) }) }
    })).rejects.toThrow("checksum");
  });

  it("loads only a current-user 0600 repository-external credential file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-support-r2-"));
    const path = join(directory, "support.env");
    await writeFile(path, [
      "PI67_SUPPORT_R2_ACCOUNT_ID=account",
      "PI67_SUPPORT_R2_ACCESS_KEY_ID=reader",
      "PI67_SUPPORT_R2_SECRET_ACCESS_KEY=secret"
    ].join("\n"), { mode: 0o600 });
    await expect(loadSupportR2Credentials(path)).resolves.toEqual({
      accountId: "account",
      accessKeyId: "reader",
      secretAccessKey: "secret"
    });
    if (process.platform !== "win32") {
      await chmod(path, 0o644);
      await expect(loadSupportR2Credentials(path)).rejects.toThrow("0600");
    }
  });

  it("labels v5 reports as aggregate-only instead of inventing causality", () => {
    const submission = fixtureSubmission();
    submission.diagnostics = {
      schema: "pi67-support-diagnostics.v5",
      generatedAt: submission.createdAt,
      application: {
        version: "0.1.0-alpha.38",
        platform: "win32",
        architecture: "x64",
        packaged: true
      },
      desktop: {},
      agentHost: {},
      piConfiguration: {},
      renderer: {},
      runtimeCollection: { status: "unavailable", failure: "connection-unavailable" }
    };
    expect(analyzeSupportDiagnostics(submission)).toMatchObject({
      evidenceCompleteness: "aggregate-only",
      findings: [{ rule: "V5_CAUSALITY_UNAVAILABLE" }]
    });
  });
});

function fixtureSubmission() {
  const createdAt = Date.UTC(2026, 7, 30, 1, 2, 3);
  const diagnostics = {
    schema: "pi67-support-diagnostics.v6",
    generatedAt: createdAt,
    application: {
      version: "0.1.0-alpha.40",
      platform: "win32",
      architecture: "x64",
      packaged: true,
      protocolRevision: "a".repeat(64)
    },
    desktop: {},
    agentHost: {},
    piConfiguration: {},
    renderer: {},
    runtimeCollection: { status: "available" },
    runtime: {},
    causality: {
      renderer: {
        actions: [
          { sequence: 1, at: createdAt, action: "task.resume", stage: "started" },
          { sequence: 4, at: createdAt + 3, action: "task.resume", stage: "failed" }
        ],
        actionsDroppedCount: 0,
        incidents: [{
          sequence: 2,
          at: createdAt + 1,
          layer: "renderer",
          phase: "request",
          outcome: "failed",
          command: "asset.read",
          errorClass: "ProtocolRequestError",
          reason: "request-failed",
          connectionGeneration: 2
        }],
        incidentsDroppedCount: 0
      },
      agentHost: {
        incidents: [{
          sequence: 1,
          at: createdAt + 2,
          layer: "agent-host",
          phase: "response-post",
          outcome: "failed",
          command: "asset.read",
          errorClass: "DataCloneError",
          reason: "response-post-failed",
          connectionSequence: 2,
          hostEpoch: 1,
          binaryBytes: 4_096
        }],
        incidentsDroppedCount: 0
      }
    }
  };
  return {
    schema: "pi67-support-submission.v1",
    reportId: "PI67-A1B2C3D4E5F6",
    createdAt,
    diagnosticsSha256: createHash("sha256")
      .update(`${JSON.stringify(diagnostics, null, 2)}\n`)
      .digest("hex"),
    diagnostics
  };
}

async function* asyncBody(value) {
  yield new TextEncoder().encode(value);
}
