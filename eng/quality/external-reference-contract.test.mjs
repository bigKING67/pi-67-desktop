import { describe, expect, it } from "vitest";
import { collectExternalReferenceIssues } from "./external-reference-contract.mjs";

const PEAK_COMMIT = "a".repeat(40);
const LICENSE_HASH = "b".repeat(64);

describe("external reference governance contract", () => {
  it("accepts a contract-managed Pi record and a source-pinned Peak Code review", () => {
    expect(validate(fixture())).toEqual([]);
  });

  it("rejects symbolic or missing review commits", () => {
    const input = fixture();
    input.reviewLock.reviews.peakcode.reviewedCommit = "main";
    input.reviewLock.reviews.peakcode.remoteHeadAtReview = null;
    expect(validate(input)).toEqual(expect.arrayContaining([
      expect.stringContaining("reviewedCommit must be a full lowercase Git object ID"),
      expect.stringContaining("remoteHeadAtReview must be a full lowercase Git object ID")
    ]));
  });

  it("keeps review state and lock presence consistent", () => {
    const missingLock = fixture();
    missingLock.reviewLock.reviews = {};
    expect(validate(missingLock)).toContain(
      "catalog repository peakcode is reviewed but has no references.lock.json record"
    );

    const candidateWithLock = fixture();
    candidateWithLock.catalog.repositories[1].reviewState = "candidate";
    expect(validate(candidateWithLock)).toContain(
      "catalog repository peakcode has reviewState candidate but also has a lock record"
    );
  });

  it("rejects the product repository and duplicate catalog URLs", () => {
    const input = fixture();
    input.catalog.repositories.push({
      ...input.catalog.repositories[1],
      id: "current-product",
      reviewState: "candidate",
      url: "https://github.com/bigKING67/pi-67-desktop"
    });
    input.catalog.repositories.push({
      ...input.catalog.repositories[1],
      id: "duplicate-peak",
      reviewState: "candidate"
    });
    expect(validate(input)).toEqual(expect.arrayContaining([
      expect.stringContaining("must not register the current product"),
      expect.stringContaining("url duplicates https://github.com/PeakCode-AI/PeakCode")
    ]));
  });

  it("requires reviewed provenance, repository targets, and notices for adapted code", () => {
    const input = fixture();
    input.provenance.entries.push({
      sourceRepository: "https://github.com/PeakCode-AI/PeakCode",
      sourceCommit: PEAK_COMMIT,
      sourcePath: "apps/web/src/example.ts",
      sourceSha256: "c".repeat(64),
      targetPath: "packages/extension-compat/src/missing.ts",
      reuseType: "adapted",
      license: { spdx: "MIT", path: "LICENSE", sha256: LICENSE_HASH },
      copyrightNotice: "Copyright (c) 2026 Peak Code AI",
      modifications: "Rewritten for the Pi-67 protocol"
    });
    expect(validate(input)).toEqual(expect.arrayContaining([
      expect.stringContaining("targetPath does not exist in the repository"),
      expect.stringContaining("noticePath must be a bounded repository-relative path")
    ]));
  });

  it("rejects review notes that do not contain the locked commit", () => {
    const input = fixture();
    input.repositoryContents.set("docs/provenance/peak-code-reference.md", "Peak Code review without a pin");
    expect(validate(input)).toContain(
      `review lock peakcode notesPath does not contain reviewedCommit ${PEAK_COMMIT}`
    );
  });
});

function validate(input) {
  return collectExternalReferenceIssues(input);
}

function fixture() {
  const catalog = {
    schemaVersion: 1,
    repositories: [
      {
        id: "pi",
        url: "https://github.com/earendil-works/pi",
        role: "specification",
        tier: "S0",
        reviewState: "contract-managed",
        defaultReuse: "dependency",
        reviewCadence: "pi-release-and-weekly",
        reviewTriggers: ["pi-sdk-upgrade"],
        constraints: ["Pi packages are the only runtime"]
      },
      {
        id: "peakcode",
        url: "https://github.com/PeakCode-AI/PeakCode",
        role: "lineage-reference",
        tier: "S1",
        reviewState: "reviewed",
        defaultReuse: "architecture-only",
        reviewCadence: "monthly-and-feature",
        reviewTriggers: ["workspace-navigation"],
        constraints: ["Do not merge or copy source automatically"]
      }
    ]
  };
  const reviewLock = {
    schemaVersion: 1,
    reviews: {
      peakcode: {
        reviewedCommit: PEAK_COMMIT,
        remoteHeadAtReview: PEAK_COMMIT,
        sourceRef: "main",
        reviewedAt: "2026-07-27",
        reviewedPaths: ["apps/web"],
        outcome: "reference-only",
        license: { spdx: "MIT", path: "LICENSE", sha256: LICENSE_HASH },
        notesPath: "docs/provenance/peak-code-reference.md"
      }
    }
  };
  return {
    catalog,
    reviewLock,
    provenance: { schemaVersion: 1, entries: [] },
    repositoryContents: new Map([
      ["docs/provenance/peak-code-reference.md", `Pinned at ${PEAK_COMMIT}`]
    ]),
    repositoryFiles: new Set([
      "docs/provenance/peak-code-reference.md",
      "packages/pi-runtime/package.json",
      "pnpm-workspace.yaml"
    ])
  };
}
