import { describe, expect, it } from "vitest";
import { browser67PackageIdentity } from "./browser67-integration-status.js";
import { parseBundledCatalog } from "./desktop-capability-contract.js";

const BASE_ENTRY = {
  id: "openviking-pi-extension",
  displayName: "OpenViking Pi Extension",
  origin: "first-party",
  bundled: true,
  defaultEnabled: true,
  version: "0.2.0-desktop.1",
  internalPath: "packages/openviking-pi-extension",
  sourceTreeSha256: "a".repeat(64),
  packagePath: "packages/openviking-pi-extension",
  resourceTypes: ["extension", "context", "memory", "experience"],
  bundledSkills: [{
    id: "test-skill",
    displayName: "Test Skill",
    description: "Exercises capability catalog provenance."
  }]
};

function catalogWith(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: "pi67.capability-catalog.v1",
    catalogVersion: "test.1",
    entries: [entry],
    bundledSkillSuites: [{
      id: "test-suite",
      displayName: "Test suite",
      description: "Exercises capability catalog provenance.",
      versionSource: "capability-package",
      bundledVersion: String(entry.version),
      upstream: "https://github.com/example/test-suite",
      sourceCommit: "d".repeat(40),
      updatePolicy: "capability-package",
      updateManager: "desktop-capability",
      independentUpdateState: "not-applicable",
      members: [{ packageId: String(entry.id), skillId: "test-skill" }]
    }]
  };
}

describe("Desktop capability catalog provenance", () => {
  it("accepts a Desktop-internal package and preserves context resource types", () => {
    const catalog = parseBundledCatalog(catalogWith(BASE_ENTRY));

    expect(catalog.entries).toEqual([{
      ...BASE_ENTRY,
      bundledExtensions: []
    }]);
    expect(catalog.bundledSkillSuites).toHaveLength(1);
    expect(catalog.recommendedExternal).toEqual([]);
    expect(browser67PackageIdentity(catalog)).toBeUndefined();
  });

  it("keeps Git provenance exclusive from Desktop-internal provenance", () => {
    const gitEntry = {
      id: "browser67",
      displayName: "browser67",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "0.8.0",
      commit: "b".repeat(40),
      packagePath: "packages/browser67",
      resourceTypes: ["skill", "integration"],
      bundledSkills: BASE_ENTRY.bundledSkills
    };
    const catalog = parseBundledCatalog(catalogWith(gitEntry));

    expect(browser67PackageIdentity(catalog)).toBe(`0.8.0:${"b".repeat(40)}`);
    expect(() => parseBundledCatalog(catalogWith({
      ...gitEntry,
      internalPath: "packages/browser67",
      sourceTreeSha256: "c".repeat(64)
    }))).toThrow(/catalog entry is invalid/u);
  });
});
