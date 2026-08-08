import { describe, expect, it } from "vitest";
import { createExternalReferenceAudit } from "./audit-external-reference-drift.mjs";

const PI_HEAD = "1".repeat(40);
const PI_GUI_HEAD = "2".repeat(40);
const T3CODE_HEAD = "3".repeat(40);
const LICENSE_HASH = "4".repeat(64);

describe("external reference drift audit", () => {
  it("reports Pi and both comprehensive references as current", async () => {
    const input = fixture();
    const report = await createExternalReferenceAudit({
      ...input,
      selectedRepositories: input.catalog.repositories,
      installedPiVersion: "0.83.0",
      now: () => new Date("2026-08-08T00:00:00.000Z"),
      readPiLatest: async () => "0.83.0",
      readLicense: async () => LICENSE_HASH,
      resolveRemote: async (url) => ({
        defaultBranch: "main",
        head: url.endsWith("/pi")
          ? PI_HEAD
          : url.endsWith("/pi-gui") ? PI_GUI_HEAD : T3CODE_HEAD
      })
    });

    expect(report.generatedAt).toBe("2026-08-08T00:00:00.000Z");
    expect(report.statuses).toEqual({ current: 3 });
    expect(report.repositories.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "pi", status: "current" },
      { id: "pi-gui", status: "current" },
      { id: "t3code", status: "current" }
    ]);
  });

  it("reports source drift and the exact review range", async () => {
    const input = fixture();
    const nextHead = "5".repeat(40);
    const report = await createExternalReferenceAudit({
      ...input,
      selectedRepositories: [input.catalog.repositories[2]],
      installedPiVersion: "0.83.0",
      readLicense: async () => LICENSE_HASH,
      resolveRemote: async () => ({ defaultBranch: "main", head: nextHead })
    });
    expect(report.repositories[0]).toMatchObject({
      id: "t3code",
      status: "drifted",
      reviewRange: `${T3CODE_HEAD}..${nextHead}`
    });
  });

  it("gives license drift precedence over source drift", async () => {
    const input = fixture();
    const report = await createExternalReferenceAudit({
      ...input,
      selectedRepositories: [input.catalog.repositories[1]],
      installedPiVersion: "0.83.0",
      readLicense: async () => "6".repeat(64),
      resolveRemote: async () => ({ defaultBranch: "main", head: "5".repeat(40) })
    });
    expect(report.repositories[0]).toMatchObject({ id: "pi-gui", status: "license-changed" });
  });

  it("records bounded network failures instead of throwing away the report", async () => {
    const input = fixture();
    const report = await createExternalReferenceAudit({
      ...input,
      selectedRepositories: [input.catalog.repositories[2]],
      installedPiVersion: "0.83.0",
      resolveRemote: async () => {
        throw new Error(`network failed\n${"x".repeat(500)}`);
      }
    });
    expect(report.repositories[0].status).toBe("unreachable");
    expect(report.repositories[0].error).not.toContain("\n");
    expect(report.repositories[0].error.length).toBeLessThanOrEqual(300);
  });
});

function fixture() {
  return {
    catalog: {
      schemaVersion: 1,
      repositories: [
        { id: "pi", url: "https://github.com/earendil-works/pi", tier: "S0", reviewState: "contract-managed" },
        { id: "pi-gui", url: "https://github.com/minghinmatthewlam/pi-gui", tier: "S1", reviewState: "reviewed" },
        { id: "t3code", url: "https://github.com/pingdotgg/t3code", tier: "S1", reviewState: "reviewed" }
      ]
    },
    reviewLock: {
      reviews: {
        "pi-gui": {
          reviewedCommit: PI_GUI_HEAD,
          sourceRef: "main",
          license: { path: "LICENSE", sha256: LICENSE_HASH }
        },
        t3code: {
          reviewedCommit: T3CODE_HEAD,
          sourceRef: "main",
          license: { path: "LICENSE", sha256: LICENSE_HASH }
        }
      }
    }
  };
}
