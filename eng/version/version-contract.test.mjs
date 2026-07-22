import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectVersionProjections,
  loadVersionContract,
  releaseArtifactNames,
  validateVersionContract,
} from "./version-contract.mjs";

test("the canonical version has matching repository projections", async () => {
  const version = await loadVersionContract();

  assert.deepEqual(await inspectVersionProjections(version), []);
  assert.deepEqual(releaseArtifactNames(version), {
    msi: `Pi67-Desktop-${version.semver}-win-x64.msi`,
    bundle: `Pi67-Desktop-Setup-${version.semver}-win-x64.exe`,
    ciArchive: `pi67-desktop-${version.semver}-win-x64-unsigned`,
  });
});

test("the version contract rejects release identity drift", () => {
  assert.deepEqual(validateVersionContract({
    schemaVersion: 1,
    semver: "1.2.3-alpha.4",
    msiVersion: "1.2.3.0",
    releaseTag: "desktop-v1.2.3-alpha.3",
  }), ["releaseTag must equal desktop-v{semver}"]);
});
