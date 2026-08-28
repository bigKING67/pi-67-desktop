import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveMacosPreviewEvidencePaths,
  verifyMacosPreviewCandidateFiles,
  writeMacosPreviewCandidateEvidence
} from "./macos-preview-candidate.mjs";

const temporaryDirectories = [];

describe("macOS preview candidate evidence", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("binds source, packaged smoke, app, DMG, and ZIP identities", async () => {
    const fixture = await createFixture();
    const written = await writeFixtureEvidence(fixture);

    await expect(verifyMacosPreviewCandidateFiles({
      candidateIdentityPath: written.paths.candidateIdentityPath,
      dmgPath: written.paths.dmgPath,
      expectedRepository: fixture.repository,
      expectedRuntimeSpecifier: fixture.runtimeSpecifier,
      expectedSourceCommit: fixture.source.commit,
      packagedSmokeReceiptPath: written.paths.packagedSmokeReceiptPath,
      version: fixture.version,
      zipPath: written.paths.zipPath
    })).resolves.toMatchObject({
      identity: {
        source: fixture.source,
        application: { version: fixture.version, platform: "darwin", architecture: "arm64" },
        packagedSmoke: { status: "passed" }
      }
    });
  });

  it("rejects artifact drift after the smoke receipt was written", async () => {
    const fixture = await createFixture();
    const written = await writeFixtureEvidence(fixture);
    await writeFile(written.paths.zipPath, "changed-zip");

    await expect(verifyMacosPreviewCandidateFiles({
      candidateIdentityPath: written.paths.candidateIdentityPath,
      dmgPath: written.paths.dmgPath,
      expectedRepository: fixture.repository,
      expectedRuntimeSpecifier: fixture.runtimeSpecifier,
      expectedSourceCommit: fixture.source.commit,
      packagedSmokeReceiptPath: written.paths.packagedSmokeReceiptPath,
      version: fixture.version,
      zipPath: written.paths.zipPath
    })).rejects.toThrow("macOS preview ZIP bytes do not match");
  });

  it("rejects a modified packaged-smoke receipt", async () => {
    const fixture = await createFixture();
    const written = await writeFixtureEvidence(fixture);
    const receipt = JSON.parse(await readFile(written.paths.packagedSmokeReceiptPath, "utf8"));
    receipt.source.commit = "b".repeat(40);
    await writeFile(written.paths.packagedSmokeReceiptPath, JSON.stringify(receipt));

    await expect(verifyMacosPreviewCandidateFiles({
      candidateIdentityPath: written.paths.candidateIdentityPath,
      dmgPath: written.paths.dmgPath,
      expectedRepository: fixture.repository,
      expectedRuntimeSpecifier: fixture.runtimeSpecifier,
      expectedSourceCommit: fixture.source.commit,
      packagedSmokeReceiptPath: written.paths.packagedSmokeReceiptPath,
      version: fixture.version,
      zipPath: written.paths.zipPath
    })).rejects.toThrow(/source commit mismatch|receipt bytes do not match/u);
  });

  it("fails closed for dirty source when release verification requires clean source", async () => {
    const fixture = await createFixture({ sourceClean: false });
    const written = await writeFixtureEvidence(fixture);

    await expect(verifyMacosPreviewCandidateFiles({
      candidateIdentityPath: written.paths.candidateIdentityPath,
      dmgPath: written.paths.dmgPath,
      expectedRepository: fixture.repository,
      expectedRuntimeSpecifier: fixture.runtimeSpecifier,
      expectedSourceCommit: fixture.source.commit,
      packagedSmokeReceiptPath: written.paths.packagedSmokeReceiptPath,
      version: fixture.version,
      zipPath: written.paths.zipPath
    })).rejects.toThrow("source clean state mismatch");
  });

  it("creates evidence only on the supported native host", async () => {
    const fixture = await createFixture();
    await expect(writeMacosPreviewCandidateEvidence({
      host: { platform: "linux", architecture: "x64" },
      paths: fixture.paths,
      releaseRoot: fixture.releaseRoot,
      repository: fixture.repository,
      runtimeSpecifier: fixture.runtimeSpecifier,
      source: fixture.source,
      version: fixture.version
    })).rejects.toThrow("require darwin/arm64");
  });
});

async function createFixture({ sourceClean = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi67-macos-candidate-"));
  temporaryDirectories.push(root);
  const releaseRoot = join(root, "release");
  const version = "0.1.0-alpha.37";
  const paths = resolveMacosPreviewEvidencePaths(version, releaseRoot);
  await Promise.all([
    mkdir(join(paths.applicationPath, "Contents/MacOS"), { recursive: true }),
    mkdir(join(paths.applicationPath, "Contents/Resources"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(paths.executablePath, "packaged-executable"),
    writeFile(paths.appAsarPath, "packaged-asar"),
    writeFile(paths.dmgPath, "macos-dmg"),
    writeFile(paths.zipPath, "macos-zip")
  ]);
  return {
    paths,
    releaseRoot,
    repository: "bigKING67/pi-67-desktop",
    runtimeSpecifier: "@earendil-works/pi-coding-agent@0.84.3",
    source: { policy: "main", commit: "a".repeat(40), clean: sourceClean },
    version
  };
}

function writeFixtureEvidence(fixture) {
  return writeMacosPreviewCandidateEvidence({
    host: { platform: "darwin", architecture: "arm64" },
    paths: fixture.paths,
    releaseRoot: fixture.releaseRoot,
    repository: fixture.repository,
    runtimeSpecifier: fixture.runtimeSpecifier,
    source: fixture.source,
    verifyContainers: async () => undefined,
    version: fixture.version
  });
}
