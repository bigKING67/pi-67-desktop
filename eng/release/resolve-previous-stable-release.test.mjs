import { describe, expect, it } from "vitest";
import {
  formatPreviousStableReleaseOutputs,
  resolvePreviousStableRelease,
  validatePreviousStableResolution
} from "./resolve-previous-stable-release.mjs";

const repository = "bigKING67/pi-67-desktop";

describe("direct previous stable release resolution", () => {
  it("selects the greatest published stable release and binds exact asset IDs", () => {
    const result = resolvePreviousStableRelease([
      [release(20, "v1.10.0"), release(21, "v1.11.0-beta.1")],
      [release(19, "v1.9.0"), release(22, "v1.11.0", { prerelease: true })]
    ], "v2.0.0", repository);

    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: "resolved",
      repository,
      candidate: { tag: "v2.0.0", version: "2.0.0" },
      baseline: {
        releaseId: 20,
        tag: "v1.10.0",
        version: "1.10.0",
        manifestAsset: { id: 201 },
        installerAsset: { id: 202 }
      }
    });
    expect(validatePreviousStableResolution(result, repository, "v2.0.0")).toBe(result);
    expect(formatPreviousStableReleaseOutputs(result)).toEqual([
      "baseline_kind=resolved",
      "first_signed_release=false"
    ]);
  });

  it("records an explicit first stable release when only prereleases exist", () => {
    const result = resolvePreviousStableRelease([
      release(1, "v0.1.0-alpha.3", { prerelease: true })
    ], "v1.0.0", repository);
    expect(result).toEqual({
      schemaVersion: 1,
      kind: "first-stable-release",
      repository,
      candidate: { tag: "v1.0.0", version: "1.0.0" }
    });
    expect(formatPreviousStableReleaseOutputs(result)).toContain("first_signed_release=true");
  });

  it("rejects prerelease candidates, existing candidates, older candidates, and duplicate stable versions", () => {
    expect(() => resolvePreviousStableRelease([], "v1.0.0-alpha.1", repository))
      .toThrow("Invalid canonical signed candidate tag");
    expect(() => resolvePreviousStableRelease([release(1, "v1.0.0")], "v1.0.0", repository))
      .toThrow("already exists");
    expect(() => resolvePreviousStableRelease([release(1, "v2.0.0")], "v1.0.0", repository))
      .toThrow("must be newer than the latest stable release");
    expect(() => resolvePreviousStableRelease([
      release(1, "v1.0.0"),
      release(2, "v1.0.0")
    ], "v2.0.0", repository)).toThrow("duplicate stable version");
  });

  it("rejects unpublished stable records, malformed assets, and mixed pagination", () => {
    expect(() => resolvePreviousStableRelease([
      release(1, "v1.0.0", { published_at: null })
    ], "v2.0.0", repository)).toThrow("is not published");
    expect(() => resolvePreviousStableRelease([
      release(1, "v1.0.0", { assets: [] })
    ], "v2.0.0", repository)).toThrow("exactly one release-manifest.json");
    expect(() => resolvePreviousStableRelease([[release(1, "v1.0.0")], release(2, "v1.1.0")], "v2.0.0", repository))
      .toThrow("cannot mix release objects and pages");
  });
});

function release(id, tagName, overrides = {}) {
  const version = /^v(\d+\.\d+\.\d+)$/u.exec(tagName)?.[1] ?? "0.0.0";
  return {
    id,
    tag_name: tagName,
    draft: false,
    prerelease: false,
    published_at: "2026-07-01T00:00:00Z",
    immutable: true,
    assets: [
      asset(id * 10 + 1, "release-manifest.json", 100),
      asset(id * 10 + 2, `Pi-67-Desktop-${version}-win-x64.exe`, 1_000)
    ],
    ...overrides
  };
}

function asset(id, name, size) {
  return { id, name, size, state: "uploaded", digest: null };
}
