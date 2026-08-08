import { describe, expect, it } from "vitest";
import { collectExternalReferenceIssues } from "./external-reference-contract.mjs";

const PI_GUI_COMMIT = "a".repeat(40);
const T3CODE_COMMIT = "c".repeat(40);
const LICENSE_HASH = "b".repeat(64);

describe("external reference governance contract", () => {
  it("accepts Pi plus the two comprehensive fixed-commit references", () => {
    expect(validate(fixture())).toEqual([]);
  });

  it("requires the exact pi, pi-gui, and t3code catalog set", () => {
    const missing = fixture();
    missing.catalog.repositories.pop();
    delete missing.reviewLock.reviews.t3code;
    expect(validate(missing)).toContain("catalog must register required repository t3code");

    const extra = fixture();
    extra.catalog.repositories.push({
      ...extra.catalog.repositories[1],
      id: "other-reference",
      url: "https://github.com/example/other-reference",
      reviewState: "candidate"
    });
    expect(validate(extra)).toContain("catalog repository other-reference is not an allowed reference");
  });

  it("requires canonical comprehensive roles, URLs, tiers, and cadence", () => {
    const input = fixture();
    input.catalog.repositories[1].role = "product-reference";
    input.catalog.repositories[2].url = "https://github.com/pingdotgg/not-t3code";
    input.catalog.repositories[2].reviewCadence = "pi-release-and-weekly";

    expect(validate(input)).toEqual(expect.arrayContaining([
      "catalog repository pi-gui role must equal comprehensive-reference",
      "catalog repository t3code url must equal https://github.com/pingdotgg/t3code",
      "catalog repository t3code reviewCadence must equal weekly-and-feature"
    ]));
  });

  it("rejects symbolic or missing review commits", () => {
    const input = fixture();
    input.reviewLock.reviews.t3code.reviewedCommit = "main";
    input.reviewLock.reviews.t3code.remoteHeadAtReview = null;
    expect(validate(input)).toEqual(expect.arrayContaining([
      expect.stringContaining("reviewedCommit must be a full lowercase Git object ID"),
      expect.stringContaining("remoteHeadAtReview must be a full lowercase Git object ID")
    ]));
  });

  it("keeps review state and lock presence consistent", () => {
    const missingLock = fixture();
    delete missingLock.reviewLock.reviews.t3code;
    expect(validate(missingLock)).toContain(
      "catalog repository t3code is reviewed but has no references.lock.json record"
    );

    const candidateWithLock = fixture();
    candidateWithLock.catalog.repositories[1].reviewState = "candidate";
    expect(validate(candidateWithLock)).toContain(
      "catalog repository pi-gui has reviewState candidate but also has a lock record"
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
      ...input.catalog.repositories[2],
      id: "duplicate-t3code",
      reviewState: "candidate"
    });
    expect(validate(input)).toEqual(expect.arrayContaining([
      expect.stringContaining("must not register the current product"),
      expect.stringContaining("url duplicates https://github.com/pingdotgg/t3code")
    ]));
  });

  it("requires matching provenance for a reimplemented locked review", () => {
    const missing = fixture();
    missing.reviewLock.reviews.t3code.outcome = "reimplemented";
    expect(validate(missing)).toContain(
      "review lock t3code outcome reimplemented requires matching code provenance"
    );

    const recorded = fixture();
    recorded.reviewLock.reviews.t3code.outcome = "reimplemented";
    recorded.provenance.entries.push(t3codeProvenance());
    expect(validate(recorded)).toEqual([]);
  });

  it("requires repository targets and notices for adapted code", () => {
    const input = fixture();
    input.provenance.entries.push({
      ...t3codeProvenance(),
      sourcePath: "apps/web/src/example.ts",
      targetPath: "apps/agent-host/src/missing.ts",
      reuseType: "adapted"
    });
    expect(validate(input)).toEqual(expect.arrayContaining([
      expect.stringContaining("targetPath does not exist in the repository"),
      expect.stringContaining("noticePath must be a bounded repository-relative path")
    ]));
  });

  it("rejects review notes that do not contain the locked commit", () => {
    const input = fixture();
    input.repositoryContents.set("docs/provenance/t3code-reference.md", "t3code review without a pin");
    expect(validate(input)).toContain(
      `review lock t3code notesPath does not contain reviewedCommit ${T3CODE_COMMIT}`
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
      comprehensiveReference(
        "pi-gui",
        "https://github.com/minghinmatthewlam/pi-gui"
      ),
      comprehensiveReference("t3code", "https://github.com/pingdotgg/t3code")
    ]
  };
  const reviewLock = {
    schemaVersion: 1,
    reviews: {
      "pi-gui": review(PI_GUI_COMMIT, "docs/provenance/pi-gui-reference.md"),
      t3code: review(T3CODE_COMMIT, "docs/provenance/t3code-reference.md")
    }
  };
  return {
    catalog,
    reviewLock,
    provenance: { schemaVersion: 1, entries: [] },
    repositoryContents: new Map([
      ["docs/provenance/pi-gui-reference.md", `Pinned at ${PI_GUI_COMMIT}`],
      ["docs/provenance/t3code-reference.md", `Pinned at ${T3CODE_COMMIT}`]
    ]),
    repositoryFiles: new Set([
      "apps/agent-host/src/session-creation-resolution-coordinator.ts",
      "docs/provenance/pi-gui-reference.md",
      "docs/provenance/t3code-reference.md",
      "packages/pi-runtime/package.json",
      "pnpm-workspace.yaml"
    ])
  };
}

function comprehensiveReference(id, url) {
  return {
    id,
    url,
    role: "comprehensive-reference",
    tier: "S1",
    reviewState: "reviewed",
    defaultReuse: "reimplement-preferred",
    reviewCadence: "weekly-and-feature",
    reviewTriggers: ["product-design"],
    constraints: ["Review fixed commits only"]
  };
}

function review(commit, notesPath) {
  return {
    reviewedCommit: commit,
    remoteHeadAtReview: commit,
    sourceRef: "main",
    reviewedAt: "2026-08-08",
    reviewedPaths: ["README.md"],
    outcome: "reference-only",
    license: { spdx: "MIT", path: "LICENSE", sha256: LICENSE_HASH },
    notesPath
  };
}

function t3codeProvenance() {
  return {
    sourceRepository: "https://github.com/pingdotgg/t3code",
    sourceCommit: T3CODE_COMMIT,
    sourcePath: "packages/shared/src/DrainableWorker.ts",
    sourceSha256: "d".repeat(64),
    targetPath: "apps/agent-host/src/session-creation-resolution-coordinator.ts",
    reuseType: "reimplemented",
    license: { spdx: "MIT", path: "LICENSE", sha256: LICENSE_HASH },
    copyrightNotice: "Copyright (c) 2026 T3 Tools Inc.",
    modifications: "Reimplemented bounded shutdown drain semantics."
  };
}
