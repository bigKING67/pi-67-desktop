import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareR2UpdateBundle, r2UpdateUploadOrder } from "./prepare-r2-update-bundle.mjs";
import { prepareUnsignedPreview } from "./unsigned-preview-artifacts.mjs";
import { readFileByteIdentity } from "../packaging/windows-artifact-identity.mjs";
import { createWindowsPreviewCandidateIdentity } from "./windows-preview-candidate.mjs";
import { WINDOWS_PREVIEW_MANUAL_TEST_SCHEMA } from "./windows-preview-promotion.mjs";
import { loadLocalR2Release } from "./r2-update-release-contract.mjs";
import {
  resolveMacosPreviewEvidencePaths,
  writeMacosPreviewCandidateEvidence
} from "./macos-preview-candidate.mjs";

const temporaryDirectories = [];

describe("R2 update bundle", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("copies only verified artifacts and puts mutable metadata last in upload order", async () => {
    const root = await temporaryDirectory();
    const releaseDirectory = join(root, "release");
    const outputDirectory = join(root, "r2");
    const version = "0.1.0-alpha.30";
    const runtimeVersion = "0.55.3";
    await writeSources(releaseDirectory, version);
    await writeWindowsProvenance(releaseDirectory, version, runtimeVersion);
    await writeMacosProvenance(releaseDirectory, version, runtimeVersion);
    await prepareUnsignedPreview(releaseDirectory, version, runtimeVersion);

    const result = await prepareR2UpdateBundle({
      releaseDirectory,
      outputDirectory,
      version,
      runtimeVersion
    });

    expect(result.files).toEqual(r2UpdateUploadOrder(version));
    expect(result.localProvenanceFiles).toEqual([
      "windows-preview-candidate-identity.json",
      "windows-preview-manual-test.json",
      "macos-preview-candidate-identity.json",
      "macos-preview-packaged-smoke.json"
    ]);
    expect(result.metadataLast).toBe("unsigned-preview-manifest.json");
    expect(await readdir(outputDirectory)).toHaveLength(8);
    expect(JSON.parse(await readFile(join(outputDirectory, "unsigned-preview-manifest.json"), "utf8")))
      .toMatchObject({ version, channel: "unsigned-preview", signed: false });
    await expect(loadLocalR2Release({
      directory: outputDirectory,
      version,
      runtimeVersion
    })).resolves.toMatchObject({
      provenance: {
        repository: "bigKING67/pi-67-desktop",
        sourceCommit: "a".repeat(40),
        windowsCandidateRunId: "42",
        windowsCandidateRunAttempt: "2",
        macosCandidateIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        macosPackagedSmokeReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
  });

  it("fails closed instead of copying a modified artifact", async () => {
    const root = await temporaryDirectory();
    const releaseDirectory = join(root, "release");
    const outputDirectory = join(root, "r2");
    const version = "0.1.0-alpha.30";
    const runtimeVersion = "0.55.3";
    await writeSources(releaseDirectory, version);
    await writeWindowsProvenance(releaseDirectory, version, runtimeVersion);
    await writeMacosProvenance(releaseDirectory, version, runtimeVersion);
    await prepareUnsignedPreview(releaseDirectory, version, runtimeVersion);
    await writeFile(
      join(releaseDirectory, `Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`),
      "modified"
    );

    await expect(prepareR2UpdateBundle({
      releaseDirectory,
      outputDirectory,
      version,
      runtimeVersion
    })).rejects.toThrow("verification failed");
  });

  it("rejects a malformed local manifest before resolving any artifact path", async () => {
    const directory = await temporaryDirectory();
    const version = "0.1.0-alpha.30";
    const runtimeVersion = "0.55.3";
    await writeFile(join(directory, "unsigned-preview-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      product: "Pi-67 Desktop",
      version,
      channel: "unsigned-preview",
      signed: false,
      runtime: `@earendil-works/pi-coding-agent@${runtimeVersion}`,
      files: [{ name: "../../outside", target: "windows-x64", bytes: 1, sha256: "a".repeat(64) }]
    }));

    await expect(loadLocalR2Release({ directory, version, runtimeVersion }))
      .rejects.toThrow("unsupported artifact name");
  });

  it("rejects a symbolic-link artifact in an otherwise valid local bundle", async () => {
    const root = await temporaryDirectory();
    const releaseDirectory = join(root, "release");
    const outputDirectory = join(root, "r2");
    const version = "0.1.0-alpha.30";
    const runtimeVersion = "0.55.3";
    await writeSources(releaseDirectory, version);
    await writeWindowsProvenance(releaseDirectory, version, runtimeVersion);
    await writeMacosProvenance(releaseDirectory, version, runtimeVersion);
    await prepareUnsignedPreview(releaseDirectory, version, runtimeVersion);
    await prepareR2UpdateBundle({ releaseDirectory, outputDirectory, version, runtimeVersion });
    const artifactPath = join(
      outputDirectory,
      `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.zip`
    );
    const targetPath = join(root, "outside.zip");
    await writeFile(targetPath, "macos-zip");
    await rm(artifactPath);
    await symlink(targetPath, artifactPath);

    await expect(loadLocalR2Release({ directory: outputDirectory, version, runtimeVersion }))
      .rejects.toThrow("not a regular file");
  });

  it("rejects macOS artifacts built from a different source commit", async () => {
    const root = await temporaryDirectory();
    const releaseDirectory = join(root, "release");
    const outputDirectory = join(root, "r2");
    const version = "0.1.0-alpha.30";
    const runtimeVersion = "0.55.3";
    await writeSources(releaseDirectory, version);
    await writeWindowsProvenance(releaseDirectory, version, runtimeVersion);
    await writeMacosProvenance(releaseDirectory, version, runtimeVersion, "b".repeat(40));
    await prepareUnsignedPreview(releaseDirectory, version, runtimeVersion);
    await prepareR2UpdateBundle({ releaseDirectory, outputDirectory, version, runtimeVersion });

    await expect(loadLocalR2Release({ directory: outputDirectory, version, runtimeVersion }))
      .rejects.toThrow("source commit mismatch");
  });
});

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-r2-update-bundle-"));
  temporaryDirectories.push(path);
  return path;
}

async function writeSources(directory, version) {
  await Promise.all([
    mkdir(join(directory, "win-unpacked"), { recursive: true }),
    mkdir(join(directory, "mac-arm64/Pi-67 Desktop.app/Contents/MacOS"), { recursive: true }),
    mkdir(join(directory, "mac-arm64/Pi-67 Desktop.app/Contents/Resources"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(directory, `Pi-67-Desktop-${version}-win-x64.exe`), "windows"),
    writeFile(join(directory, "win-unpacked/Pi-67 Desktop.exe"), "windows-executable"),
    writeFile(join(directory, `Pi-67-Desktop-${version}-mac-arm64.dmg`), "macos-dmg"),
    writeFile(join(directory, `Pi-67-Desktop-${version}-mac-arm64.zip`), "macos-zip"),
    writeFile(join(directory, "mac-arm64/Pi-67 Desktop.app/Contents/MacOS/Pi-67 Desktop"), "macos-executable"),
    writeFile(join(directory, "mac-arm64/Pi-67 Desktop.app/Contents/Resources/app.asar"), "macos-asar")
  ]);
}

async function writeMacosProvenance(
  directory,
  version,
  runtimeVersion,
  sourceCommit = "a".repeat(40)
) {
  await writeMacosPreviewCandidateEvidence({
    host: { platform: "darwin", architecture: "arm64" },
    paths: resolveMacosPreviewEvidencePaths(version, directory),
    releaseRoot: directory,
    repository: "bigKING67/pi-67-desktop",
    runtimeSpecifier: `@earendil-works/pi-coding-agent@${runtimeVersion}`,
    source: { policy: "main", commit: sourceCommit, clean: true },
    verifyContainers: async () => undefined,
    version
  });
}

async function writeWindowsProvenance(directory, version, runtimeVersion) {
  const identity = await createWindowsPreviewCandidateIdentity({
    host: { platform: "win32", architecture: "x64" },
    installerPath: join(directory, `Pi-67-Desktop-${version}-win-x64.exe`),
    packagedExecutablePath: join(directory, "win-unpacked/Pi-67 Desktop.exe"),
    releaseRoot: directory,
    repository: "bigKING67/pi-67-desktop",
    runAttempt: "2",
    runId: "42",
    runtimeSpecifier: `@earendil-works/pi-coding-agent@${runtimeVersion}`,
    sourceCommit: "a".repeat(40),
    version
  });
  const identityPath = join(directory, "windows-preview-candidate-identity.json");
  await writeFile(identityPath, JSON.stringify(identity));
  const identityFile = await readFileByteIdentity(identityPath);
  await writeFile(join(directory, "windows-preview-manual-test.json"), JSON.stringify({
    schema: WINDOWS_PREVIEW_MANUAL_TEST_SCHEMA,
    status: "passed",
    evidenceLevel: "manual-windows-x64-test-confirmed",
    repository: identity.repository,
    source: { commit: identity.source.commit },
    candidate: {
      identitySha256: identityFile.sha256,
      runId: identity.workflow.runId,
      runAttempt: identity.workflow.runAttempt,
      installerSha256: identity.installer.sha256,
      packagedExecutableSha256: identity.packagedExecutable.sha256
    },
    attestation: { actor: "fixture" },
    promotion: { runId: "99", runAttempt: "1" }
  }));
}
