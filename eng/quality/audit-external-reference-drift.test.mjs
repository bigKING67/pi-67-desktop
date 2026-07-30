import { describe, expect, it } from "vitest";
import { createExternalReferenceAudit } from "./audit-external-reference-drift.mjs";

const PI_HEAD = "1".repeat(40);
const PEAK_HEAD = "2".repeat(40);
const CANDIDATE_HEAD = "3".repeat(40);
const LICENSE_HASH = "4".repeat(64);

describe("external reference drift audit", () => {
  it("distinguishes contract-managed, reviewed, and unreviewed repositories", async () => {
    const input = fixture();
    const report = await createExternalReferenceAudit({
      ...input,
      selectedRepositories: input.catalog.repositories,
      installedPiVersion: "0.81.1",
      now: () => new Date("2026-07-27T00:00:00.000Z"),
      readPiLatest: async () => "0.81.1",
      readLicense: async () => LICENSE_HASH,
      resolveRemote: async (url) => ({
        defaultBranch: "main",
        head: url.endsWith("/pi") ? PI_HEAD : url.endsWith("/PeakCode") ? PEAK_HEAD : CANDIDATE_HEAD
      })
    });

    expect(report.generatedAt).toBe("2026-07-27T00:00:00.000Z");
    expect(report.statuses).toEqual({ current: 2, unreviewed: 1 });
    expect(report.repositories.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "pi", status: "current" },
      { id: "peakcode", status: "current" },
      { id: "pi-app", status: "unreviewed" }
    ]);
  });

  it("reports source drift and the exact review range", async () => {
    const input = fixture();
    const nextHead = "5".repeat(40);
    const report = await createExternalReferenceAudit({
      ...input,
      selectedRepositories: [input.catalog.repositories[1]],
      installedPiVersion: "0.81.1",
      readLicense: async () => LICENSE_HASH,
      resolveRemote: async () => ({ defaultBranch: "main", head: nextHead })
    });
    expect(report.repositories[0]).toMatchObject({
      status: "drifted",
      reviewRange: `${PEAK_HEAD}..${nextHead}`
    });
  });

  it("gives license drift precedence over source drift", async () => {
    const input = fixture();
    const report = await createExternalReferenceAudit({
      ...input,
      selectedRepositories: [input.catalog.repositories[1]],
      installedPiVersion: "0.81.1",
      readLicense: async () => "6".repeat(64),
      resolveRemote: async () => ({ defaultBranch: "main", head: "5".repeat(40) })
    });
    expect(report.repositories[0].status).toBe("license-changed");
  });

  it("records bounded network failures instead of throwing away the report", async () => {
    const input = fixture();
    const report = await createExternalReferenceAudit({
      ...input,
      selectedRepositories: [input.catalog.repositories[2]],
      installedPiVersion: "0.81.1",
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
        { id: "peakcode", url: "https://github.com/PeakCode-AI/PeakCode", tier: "S1", reviewState: "reviewed" },
        { id: "pi-app", url: "https://github.com/justhil/pi-app", tier: "S1", reviewState: "candidate" }
      ]
    },
    reviewLock: {
      reviews: {
        peakcode: {
          reviewedCommit: PEAK_HEAD,
          sourceRef: "main",
          license: { path: "LICENSE", sha256: LICENSE_HASH }
        }
      }
    }
  };
}
