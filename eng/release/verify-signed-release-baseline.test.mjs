import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSignedReleaseManifest } from "./release-manifest-contract.mjs";
import {
  validateFreshReleaseMetadata,
  verifySignedReleaseBaseline
} from "./verify-signed-release-baseline.mjs";

const temporaryDirectories = [];
const signer = "AB".repeat(20);
const repository = "bigKING67/pi-67-desktop";

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("direct previous signed release baseline", () => {
  it("binds release ID, asset IDs, manifest, installer bytes, and Publisher", async () => {
    const fixture = await createFixture();
    await expect(verifySignedReleaseBaseline({
      candidateTag: "v2.0.0",
      directory: fixture.directory,
      expectedSignerThumbprint: signer,
      readArtifactIdentity: async () => fixture.identity,
      releaseMetadataPath: fixture.releasePath,
      repository,
      resolutionPath: fixture.resolutionPath
    })).resolves.toMatchObject({
      status: "passed",
      baseline: { releaseId: 10, tag: "v1.0.0" }
    });
  });

  it("rejects fresh release, local bytes, and Publisher drift", async () => {
    const fixture = await createFixture();
    const common = {
      candidateTag: "v2.0.0",
      directory: fixture.directory,
      expectedSignerThumbprint: signer,
      releaseMetadataPath: fixture.releasePath,
      repository,
      resolutionPath: fixture.resolutionPath
    };
    await expect(verifySignedReleaseBaseline({
      ...common,
      readArtifactIdentity: async () => ({ ...fixture.identity, byteLength: fixture.identity.byteLength + 1 })
    })).rejects.toThrow("size");
    await expect(verifySignedReleaseBaseline({
      ...common,
      readArtifactIdentity: async () => ({
        ...fixture.identity,
        authenticode: { ...fixture.identity.authenticode, signerThumbprint: "CD".repeat(20) }
      })
    })).rejects.toThrow("unexpected Publisher");

    const release = JSON.parse(await readFile(fixture.releasePath, "utf8"));
    release.assets[1].id += 1;
    expect(validateFreshReleaseMetadata(release, fixture.resolution)).toEqual(expect.arrayContaining([
      expect.stringContaining("identity drifted")
    ]));
  });

  it("rejects extra Windows installers and unsigned manifest identity", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.directory, "Pi-67-Desktop-0.9.0-win-x64.exe"), "other");
    await expect(verifySignedReleaseBaseline({
      candidateTag: "v2.0.0",
      directory: fixture.directory,
      expectedSignerThumbprint: signer,
      readArtifactIdentity: async () => fixture.identity,
      releaseMetadataPath: fixture.releasePath,
      repository,
      resolutionPath: fixture.resolutionPath
    })).rejects.toThrow("exactly the resolved Windows installer");
  });
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "pi67-signed-baseline-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  const version = "1.0.0";
  const installerName = `Pi-67-Desktop-${version}-win-x64.exe`;
  const installer = Buffer.from("signed Windows installer fixture");
  const sha256 = createHash("sha256").update(installer).digest("hex");
  await writeFile(join(directory, installerName), installer);
  const manifest = createSignedReleaseManifest({
    version,
    runtime: "@earendil-works/pi-coding-agent@0.81.1",
    files: [
      { name: installerName, bytes: installer.length, sha256, target: "windows-x64" },
      {
        name: `Pi-67-Desktop-${version}-mac-arm64.dmg`,
        bytes: 1,
        sha256: "1".repeat(64),
        target: "macos-arm64"
      },
      {
        name: `Pi-67-Desktop-${version}-mac-arm64.zip`,
        bytes: 1,
        sha256: "2".repeat(64),
        target: "macos-arm64"
      }
    ]
  });
  await writeFile(join(directory, "release-manifest.json"), JSON.stringify(manifest));
  const resolution = {
    schemaVersion: 1,
    kind: "resolved",
    repository,
    candidate: { tag: "v2.0.0", version: "2.0.0" },
    baseline: {
      releaseId: 10,
      tag: "v1.0.0",
      version,
      publishedAt: "2026-07-01T00:00:00Z",
      immutable: true,
      manifestAsset: asset(101, "release-manifest.json", Buffer.byteLength(JSON.stringify(manifest))),
      installerAsset: asset(102, installerName, installer.length)
    }
  };
  const resolutionPath = join(directory, "resolution.json");
  const releasePath = join(directory, "release.json");
  await writeFile(resolutionPath, JSON.stringify(resolution));
  await writeFile(releasePath, JSON.stringify({
    id: 10,
    tag_name: "v1.0.0",
    draft: false,
    prerelease: false,
    published_at: "2026-07-01T00:00:00Z",
    immutable: true,
    assets: [resolution.baseline.manifestAsset, resolution.baseline.installerAsset]
  }));
  return {
    directory,
    identity: {
      byteLength: installer.length,
      sha256,
      authenticode: {
        status: "Valid",
        signerSubject: "CN=Pi-67 Desktop",
        signerThumbprint: signer
      }
    },
    releasePath,
    resolution,
    resolutionPath
  };
}

function asset(id, name, size) {
  return { id, name, size, state: "uploaded", digest: null };
}
