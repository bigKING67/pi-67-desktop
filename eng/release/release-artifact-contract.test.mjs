import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadVersionContract, releaseArtifactNames } from "../version/version-contract.mjs";
import {
  createReleaseManifestDocument,
  expectedReleaseFileNames,
  parseChecksumText,
  releasePayloadDescriptors,
} from "./release-artifact-contract.mjs";

test("the release root contract has exact versioned Windows artifact names", async () => {
  const version = await loadVersionContract();
  const names = releaseArtifactNames(version);

  assert.deepEqual(expectedReleaseFileNames(version), [
    "SHA256SUMS",
    names.bundle,
    names.msi,
    "bootstrap-inventory.json",
    "compatibility.json",
    "pi67-desktop.cdx.json",
    "provenance.intoto.json",
    "release-manifest.json",
  ].sort());
});

test("the release manifest records hashes and unsigned executable status", async () => {
  const version = await loadVersionContract();
  const root = await mkdtemp(path.join(tmpdir(), "pi67-release-contract-"));
  try {
    await Promise.all(releasePayloadDescriptors(version).map(descriptor => writeFile(
      path.join(root, descriptor.path),
      `${descriptor.type}\n`,
    )));
    const manifest = await createReleaseManifestDocument(root, version, {
      revision: "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
    }, new Date("2026-07-22T00:00:00.000Z"));

    assert.equal(manifest.signed, false);
    assert.equal(manifest.source.revision, "0123456789abcdef0123456789abcdef01234567");
    assert.equal(manifest.artifacts.length, 5);
    assert.deepEqual(
      manifest.artifacts.filter(artifact => artifact.path.endsWith(".exe") || artifact.path.endsWith(".msi"))
        .map(artifact => artifact.signatureStatus),
      ["unsigned", "unsigned"],
    );
    assert.ok(manifest.artifacts.every(artifact => /^[0-9a-f]{64}$/u.test(artifact.sha256)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checksum parsing rejects duplicate and nested release paths", () => {
  const digest = "a".repeat(64);
  assert.throws(() => parseChecksumText(`${digest}  file.exe\n${digest}  file.exe\n`), /Duplicate/u);
  assert.throws(() => parseChecksumText(`${digest}  nested\/file.exe\n`), /Invalid/u);
});
