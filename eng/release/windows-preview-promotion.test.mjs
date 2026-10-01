import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareUnsignedPreviewBundle, unsignedPreviewBundleFiles } from "./prepare-unsigned-preview-bundle.mjs";
import { prepareUnsignedPreview } from "./unsigned-preview-artifacts.mjs";
import { createWindowsPreviewCandidateIdentity } from "./windows-preview-candidate.mjs";
import { parseWindowsPreviewManualTestArguments } from "./windows-preview-manual-test.mjs";
import {
  resolveMacosPreviewEvidencePaths,
  writeMacosPreviewCandidateEvidence
} from "./macos-preview-candidate.mjs";
import {
  WINDOWS_PREVIEW_OPERATOR_MANUAL_TEST_SCHEMA,
  recordWindowsPreviewManualTest,
  verifyWindowsPreviewPromotion
} from "./windows-preview-promotion.mjs";
import { maintainLocalArtifactCopies, planLocalArtifactRetention } from "./local-artifact-retention.mjs";
import { loadRetainedPreview } from "./retained-preview.mjs";
import { recordReleaseBuildState, withReleaseArchiveLock } from "./release-archive-retention.mjs";
import { prepareR2UpdateBundle } from "./prepare-r2-update-bundle.mjs";
import { loadLocalR2Release } from "./r2-update-release-contract.mjs";
import { recordPublishedR2Release } from "./r2-update-release.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Windows preview promotion", () => {
  it("accepts the pnpm argument separator only at the CLI boundary", () => {
    expect(parseWindowsPreviewManualTestArguments(["--", "--actor", "bigKING67"]).get("--actor"))
      .toBe("bigKING67");
    expect(() => parseWindowsPreviewManualTestArguments(["--actor", "bigKING67", "--"]))
      .toThrow("arguments are incomplete");
  });

  it("binds manual confirmation to a successful candidate run and prepares an exact bundle", async () => {
    const fixture = await promotionFixture();
    const result = await verifyWindowsPreviewPromotion(fixture.promotionOptions);
    expect(result.receipt).toMatchObject({
      status: "passed",
      evidenceLevel: "manual-windows-x64-test-confirmed",
      candidate: { runId: "42", runAttempt: "2", certificationRunAttempt: "2" }
    });
    await prepareUnsignedPreview(fixture.releaseRoot, fixture.version, "0.81.1");
    const outputRoot = join(fixture.root, "bundle");
    await prepareUnsignedPreviewBundle({
      outputRoot,
      releaseRoot: fixture.releaseRoot,
      runtimeVersion: "0.81.1",
      version: fixture.version
    });
    expect((await readdir(outputRoot)).sort()).toEqual(unsignedPreviewBundleFiles(fixture.version).sort());
  });

  it("rejects a failed or mismatched candidate workflow run", async () => {
    const fixture = await promotionFixture();
    await writeFile(fixture.runMetadataPath, JSON.stringify({
      id: 42,
      run_attempt: 2,
      name: "Windows candidate",
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "failure",
      repository: { full_name: "bigKING67/pi-67-desktop" }
    }));
    await expect(verifyWindowsPreviewPromotion(fixture.promotionOptions))
      .rejects.toThrow("candidate workflow did not succeed");
  });

  it("preserves an earlier build attempt when a later certification rerun succeeds", async () => {
    const fixture = await promotionFixture();
    await writeFile(fixture.runMetadataPath, JSON.stringify({
      id: 42,
      run_attempt: 3,
      name: "Windows candidate",
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      repository: { full_name: "bigKING67/pi-67-desktop" }
    }));
    const result = await recordWindowsPreviewManualTest({
      actor: fixture.promotionOptions.actor,
      candidateIdentityPath: fixture.promotionOptions.candidateIdentityPath,
      candidateRunAttempt: fixture.promotionOptions.candidateRunAttempt,
      candidateRunId: fixture.promotionOptions.candidateRunId,
      candidateRunMetadataPath: fixture.promotionOptions.candidateRunMetadataPath,
      installerPath: fixture.promotionOptions.installerPath,
      outputPath: fixture.promotionOptions.outputPath,
      packagedExecutablePath: fixture.promotionOptions.packagedExecutablePath,
      repository: fixture.promotionOptions.repository,
      sourceCommit: fixture.promotionOptions.sourceCommit
    });

    expect(result.receipt.candidate).toMatchObject({
      runId: "42",
      runAttempt: "2",
      certificationRunAttempt: "3"
    });
  });

  it("rejects workflow metadata that predates the Candidate build attempt", async () => {
    const fixture = await promotionFixture();
    await writeFile(fixture.runMetadataPath, JSON.stringify({
      id: 42,
      run_attempt: 1,
      name: "Windows candidate",
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      repository: { full_name: "bigKING67/pi-67-desktop" }
    }));

    await expect(recordWindowsPreviewManualTest({
      actor: fixture.promotionOptions.actor,
      candidateIdentityPath: fixture.promotionOptions.candidateIdentityPath,
      candidateRunAttempt: fixture.promotionOptions.candidateRunAttempt,
      candidateRunId: fixture.promotionOptions.candidateRunId,
      candidateRunMetadataPath: fixture.promotionOptions.candidateRunMetadataPath,
      installerPath: fixture.promotionOptions.installerPath,
      outputPath: fixture.promotionOptions.outputPath,
      packagedExecutablePath: fixture.promotionOptions.packagedExecutablePath,
      repository: fixture.promotionOptions.repository,
      sourceCommit: fixture.promotionOptions.sourceCommit
    })).rejects.toThrow("certification run attempt predates candidate build attempt");
  });

  it("rejects a prepared Windows installer whose bytes differ from the tested candidate", async () => {
    const fixture = await promotionFixture();
    await verifyWindowsPreviewPromotion(fixture.promotionOptions);
    await writeFile(fixture.promotionOptions.installerPath, "substituted-installer");
    await prepareUnsignedPreview(fixture.releaseRoot, fixture.version, "0.81.1");

    await expect(prepareUnsignedPreviewBundle({
      outputRoot: join(fixture.root, "bundle"),
      releaseRoot: fixture.releaseRoot,
      runtimeVersion: "0.81.1",
      version: fixture.version
    })).rejects.toThrow("Unsigned preview Windows installer bytes do not match");
  });

  it("records an operator-confirmed receipt without inventing a promotion run", async () => {
    const fixture = await promotionFixture();
    const result = await recordWindowsPreviewManualTest({
      actor: fixture.promotionOptions.actor,
      candidateIdentityPath: fixture.promotionOptions.candidateIdentityPath,
      candidateRunAttempt: fixture.promotionOptions.candidateRunAttempt,
      candidateRunId: fixture.promotionOptions.candidateRunId,
      candidateRunMetadataPath: fixture.promotionOptions.candidateRunMetadataPath,
      installerPath: fixture.promotionOptions.installerPath,
      outputPath: fixture.promotionOptions.outputPath,
      packagedExecutablePath: fixture.promotionOptions.packagedExecutablePath,
      repository: fixture.promotionOptions.repository,
      sourceCommit: fixture.promotionOptions.sourceCommit
    });
    expect(result.receipt).toMatchObject({
      schema: WINDOWS_PREVIEW_OPERATOR_MANUAL_TEST_SCHEMA,
      status: "passed",
      evidenceLevel: "manual-windows-x64-test-confirmed",
      candidate: { runId: "42", runAttempt: "2", certificationRunAttempt: "2" },
      attestation: { actor: "bigKING67", channel: "operator-confirmed" }
    });
    expect(result.receipt).not.toHaveProperty("promotion");

    await prepareUnsignedPreview(fixture.releaseRoot, fixture.version, "0.81.1");
    const outputRoot = join(fixture.root, "operator-bundle");
    await prepareUnsignedPreviewBundle({
      outputRoot,
      releaseRoot: fixture.releaseRoot,
      runtimeVersion: "0.81.1",
      version: fixture.version
    });
    expect((await readdir(outputRoot)).sort()).toEqual(unsignedPreviewBundleFiles(fixture.version).sort());
  });
});

describe("local artifact lifecycle", () => {
  async function promote(options = {}) {
    const fixture = await promotionFixture({ ...options, managed: true });
    await verifyWindowsPreviewPromotion(fixture.promotionOptions);
    await prepareUnsignedPreview(fixture.releaseRoot, fixture.version, "0.81.1");
    await prepareUnsignedPreviewBundle({ outputRoot: join(fixture.root, "artifacts/verified-unsigned-preview"),
      releaseRoot: fixture.releaseRoot, sourceRoot: fixture.root, version: fixture.version,
      runtimeVersion: "0.81.1", probeInUse: async () => [] });
    return fixture;
  }

  it("bounds repeated promotion to current and previous installer sets while preserving all provenance and applications", async () => {
    let root;
    for (let index = 1; index <= 6; index++) {
      const fixture = await promote({ root, version: `0.1.0-alpha.${index}` }); root = fixture.root;
      const retained = await loadRetainedPreview(root);
      expect(retained.version).toBe(fixture.version);
      expect(retained.artifacts).toHaveLength(3);
      const release = await readdir(fixture.releaseRoot);
      const archives = release.filter(name => /\.(exe|zip|dmg)$/u.test(name));
      expect(archives).toHaveLength(index === 1 ? 0 : 3);
      if (index > 1) expect(archives.every(name => name.includes(`alpha.${index - 1}-`))).toBe(true);
      expect(release).not.toContain("win-unpacked");
      expect(await readFile(join(fixture.releaseRoot, "mac-arm64/New Money.app/Contents/Resources/app.asar"), "utf8"))
        .toBe("macos-asar");
    }
    expect(await readdir(join(root, "artifacts/candidates"))).toHaveLength(5);
    for (const directory of await readdir(join(root, "artifacts/candidates"))) {
      expect(await readdir(join(root, "artifacts/candidates", directory))).toHaveLength(6);
    }
  });

  it("preserves a previous verified pool when the next source verification fails", async () => {
    const first = await promote({ version: "0.1.0-alpha.1" });
    const next = await promotionFixture({ root: first.root, managed: true, version: "0.1.0-alpha.2" });
    await verifyWindowsPreviewPromotion(next.promotionOptions);
    await prepareUnsignedPreview(next.releaseRoot, next.version, "0.81.1");
    await writeFile(join(next.releaseRoot, `New-Money-${next.version}-mac-arm64-unsigned-preview.zip`), "corrupt");
    await expect(prepareUnsignedPreviewBundle({ outputRoot: join(next.root, "artifacts/verified-unsigned-preview"),
      releaseRoot: next.releaseRoot, sourceRoot: next.root, version: next.version, runtimeVersion: "0.81.1" }))
      .rejects.toThrow("verification failed");
    expect((await loadRetainedPreview(first.root)).version).toBe(first.version);
  });

  it("requires a new version before replacing verified installers with different admitted bytes", async () => {
    const first = await promote();
    const next = await promotionFixture({ root: first.root, managed: true, version: first.version });
    const paths = resolveMacosPreviewEvidencePaths(next.version, next.releaseRoot);
    await writeFile(paths.dmgPath, "new build bytes");
    await writeMacosPreviewCandidateEvidence({ host: { platform: "darwin", architecture: "arm64" }, paths,
      releaseRoot: next.releaseRoot, repository: "bigKING67/pi-67-desktop", runtimeSpecifier: "@earendil-works/pi-coding-agent@0.81.1",
      source: { policy: "main", commit: "a".repeat(40), clean: true }, verifyContainers: async () => undefined, version: next.version });
    await verifyWindowsPreviewPromotion(next.promotionOptions);
    await prepareUnsignedPreview(next.releaseRoot, next.version, "0.81.1");
    await expect(prepareUnsignedPreviewBundle({ outputRoot: join(next.root, "artifacts/verified-unsigned-preview"),
      releaseRoot: next.releaseRoot, sourceRoot: next.root, version: next.version, runtimeVersion: "0.81.1", probeInUse: async () => [] }))
      .rejects.toThrow("use a new version");
    const old = await loadRetainedPreview(first.root);
    expect(await readFile(old.artifacts.find(file => file.name.endsWith(".dmg")).path, "utf8")).toBe("dmg");
  });

  it("retires R2 aliases only after a matching successful publication and preserves local evidence", async () => {
    const fixture = await promote();
    const releaseDirectory = join(fixture.root, "artifacts/verified-unsigned-preview");
    const outputDirectory = join(fixture.root, "artifacts/r2-update-bundle");
    await prepareR2UpdateBundle({ releaseDirectory, outputDirectory, version: fixture.version, runtimeVersion: "0.81.1", sourceRoot: fixture.root });
    expect((await maintainLocalArtifactCopies({ root: fixture.root, apply: true, probeInUse: async () => [] })).removed).toEqual([]);
    const release = await loadLocalR2Release({ directory: outputDirectory, version: fixture.version, runtimeVersion: "0.81.1" });
    const calls = [];
    const result = await recordPublishedR2Release({ sourceRoot: fixture.root, release,
      result: { published: true, targetVersion: fixture.version }, probeInUse: async () => [],
      persistReceipt: async command => {
        calls.push(command);
        expect(await readdir(outputDirectory)).toHaveLength(command === "publish" ? 8 : 5);
      } });
    expect(result.localArtifactRetention.removed).toHaveLength(3);
    expect(calls).toEqual(["publish", "local-retention"]);
    expect(await readdir(outputDirectory)).toHaveLength(5);
    expect((await loadRetainedPreview(fixture.root)).artifacts).toHaveLength(3);
  });

  it("keeps retry inputs when publication is incomplete or its successful receipt cannot be saved", async () => {
    const fixture = await promote();
    const outputDirectory = join(fixture.root, "artifacts/r2-update-bundle");
    await prepareR2UpdateBundle({ releaseDirectory: join(fixture.root, "artifacts/verified-unsigned-preview"),
      outputDirectory, version: fixture.version, runtimeVersion: "0.81.1", sourceRoot: fixture.root });
    const release = await loadLocalR2Release({ directory: outputDirectory, version: fixture.version, runtimeVersion: "0.81.1" });
    await expect(recordPublishedR2Release({ sourceRoot: fixture.root, release,
      result: { published: false, targetVersion: fixture.version } })).rejects.toThrow("unpublished");
    await expect(recordPublishedR2Release({ sourceRoot: fixture.root, release,
      result: { published: true, targetVersion: fixture.version },
      persistReceipt: async () => { throw new Error("receipt unavailable"); } })).rejects.toThrow("receipt unavailable");
    const receipts = [];
    await expect(recordPublishedR2Release({ sourceRoot: fixture.root,
      release: { ...release, provenance: { ...release.provenance, sourceCommit: "b".repeat(40) } },
      result: { published: true, targetVersion: fixture.version }, probeInUse: async () => [],
      persistReceipt: async kind => { receipts.push(kind); } })).rejects.toThrow("publication succeeded and its receipt was saved");
    expect(receipts).toEqual(["publish"]);
    expect(await readdir(outputDirectory)).toHaveLength(8);
    await withReleaseArchiveLock(fixture.releaseRoot, async () => {
      await expect(prepareR2UpdateBundle({ releaseDirectory: join(fixture.root, "artifacts/verified-unsigned-preview"),
        outputDirectory, version: fixture.version, runtimeVersion: "0.81.1", sourceRoot: fixture.root })).rejects.toThrow("locked");
    });
  });

  it("reclaims a consumed Windows download while retaining its identity and diagnostic receipts", async () => {
    const fixture = await promote();
    const candidate = join(fixture.root, "artifacts/windows-candidate-42-2/release");
    await mkdir(join(candidate, "win-unpacked"), { recursive: true });
    const retained = await loadRetainedPreview(fixture.root);
    const windows = retained.artifacts.find(file => file.target === "windows-x64");
    await copyFile(windows.path, join(candidate, `New-Money-${fixture.version}-win-x64.exe`));
    await writeFile(join(candidate, "win-unpacked/New Money.exe"), "executable");
    await copyFile(join(fixture.releaseRoot, "windows-preview-candidate-identity.json"), join(candidate, "windows-preview-candidate-identity.json"));
    await writeFile(join(candidate, "diagnostic.json"), "evidence");
    const result = await maintainLocalArtifactCopies({ root: fixture.root, apply: true, probeInUse: async () => [] });
    expect(result.removed).toHaveLength(2);
    expect((await readdir(candidate)).sort()).toEqual(["diagnostic.json", "windows-preview-candidate-identity.json"]);
  });

  it("blocks occupied, late-pinned and changed duplicates before deleting any selected payload", async () => {
    const fixture = await promote();
    const retained = await loadRetainedPreview(fixture.root);
    for (const file of retained.artifacts) await copyFile(file.path, join(fixture.releaseRoot, file.name));
    await expect(maintainLocalArtifactCopies({ root: fixture.root, apply: true,
      probeInUse: async paths => [paths[0]] })).rejects.toThrow("in use");
    await expect(maintainLocalArtifactCopies({ root: fixture.root, apply: true,
      probeInUse: async paths => { await writeFile(`${paths[0]}.keep`, "pin"); return []; } })).rejects.toThrow("pinned");
    await rm(join(fixture.releaseRoot, `${retained.artifacts[0].name}.keep`), { force: true });
    // Remove the exact pin created by the probe, regardless of locale sorting.
    for (const name of await readdir(fixture.releaseRoot)) if (name.endsWith(".keep")) await rm(join(fixture.releaseRoot, name));
    await expect(maintainLocalArtifactCopies({ root: fixture.root, apply: true,
      probeInUse: async paths => { await writeFile(paths[0], "drift"); return []; } })).rejects.toThrow("changed");
    expect((await readdir(fixture.releaseRoot)).filter(name => /\.(exe|zip|dmg)$/u.test(name))).toHaveLength(3);
  });

  it("keeps unknown and different-byte copies and refuses symlinks and competing producers", async () => {
    const fixture = await promote();
    const retained = await loadRetainedPreview(fixture.root);
    const file = retained.artifacts[0];
    await writeFile(join(fixture.releaseRoot, file.name), "different");
    const plan = await planLocalArtifactRetention({ root: fixture.root });
    expect(plan.targets).toHaveLength(0);
    expect(plan.preserved[0].reason).toBe("DIFFERENT_BYTES");
    await mkdir(join(fixture.root, "artifacts/unknown"));
    await writeFile(join(fixture.root, "artifacts/unknown", file.name), "private input");
    await withReleaseArchiveLock(fixture.releaseRoot, async () => {
      await expect(maintainLocalArtifactCopies({ root: fixture.root, apply: true })).rejects.toThrow("locked");
    });
    await rm(join(fixture.releaseRoot, file.name));
    await symlink(file.path, join(fixture.releaseRoot, file.name));
    await expect(planLocalArtifactRetention({ root: fixture.root })).rejects.toThrow("regular file");
    expect(await readFile(join(fixture.root, "artifacts/unknown", file.name), "utf8")).toBe("private input");
  });

  it("refuses retirement if the retained replacement changes after planning", async () => {
    const fixture = await promote();
    const retained = await loadRetainedPreview(fixture.root);
    for (const file of retained.artifacts) await copyFile(file.path, join(fixture.releaseRoot, file.name));
    await expect(maintainLocalArtifactCopies({ root: fixture.root, apply: true, probeInUse: async () => {
      await writeFile(retained.artifacts[0].path, "replacement drift"); return [];
    } })).rejects.toThrow("replacement changed");
    expect((await readdir(fixture.releaseRoot)).filter(name => /\.(exe|zip|dmg)$/u.test(name))).toHaveLength(3);
  });

  it("never removes a failed Windows unpacked tree whose executable no longer matches admission", async () => {
    const fixture = await promotionFixture({ managed: true });
    await verifyWindowsPreviewPromotion(fixture.promotionOptions);
    await prepareUnsignedPreview(fixture.releaseRoot, fixture.version, "0.81.1");
    const outputRoot = join(fixture.root, "artifacts/verified-unsigned-preview");
    // Prepare as an explicit external bundle first, without automatic retirement.
    await prepareUnsignedPreviewBundle({ outputRoot, releaseRoot: fixture.releaseRoot, runtimeVersion: "0.81.1", version: fixture.version });
    await writeFile(join(fixture.releaseRoot, "win-unpacked/New Money.exe"), "failed executable");
    await expect(maintainLocalArtifactCopies({ root: fixture.root, apply: true, probeInUse: async () => [] }))
      .rejects.toThrow("executable differs");
    expect(await readFile(join(fixture.releaseRoot, "win-unpacked/New Money.exe"), "utf8")).toBe("failed executable");
  });

  it("keeps failed archive duplicates and their Windows tree even when their bytes match the retained pool", async () => {
    const fixture = await promote();
    const retained = await loadRetainedPreview(fixture.root);
    const windows = retained.artifacts.find(file => file.target === "windows-x64");
    await copyFile(windows.path, join(fixture.releaseRoot, `New-Money-${fixture.version}-win-x64.exe`));
    await mkdir(join(fixture.releaseRoot, "win-unpacked"));
    await writeFile(join(fixture.releaseRoot, "win-unpacked/New Money.exe"), "executable");
    await recordReleaseBuildState(fixture.releaseRoot, fixture.version, "win-x64", "FAILED");
    const result = await maintainLocalArtifactCopies({ root: fixture.root, apply: true, probeInUse: async () => [] });
    expect(result.removed).toEqual([]);
    expect(result.preserved).toContainEqual({ path: `artifacts/release/New-Money-${fixture.version}-win-x64.exe`, reason: "FAILED_BUILD" });
    expect(await readFile(join(fixture.releaseRoot, "win-unpacked/New Money.exe"), "utf8")).toBe("executable");
  });
});

async function promotionFixture(options = {}) {
  const root = options.root ?? await realpath(await mkdtemp(join(tmpdir(), "pi67-windows-preview-promotion-")));
  if (!options.root) temporaryDirectories.push(root);
  const releaseRoot = join(root, options.managed ? "artifacts/release" : "release");
  const unpacked = join(releaseRoot, "win-unpacked");
  const version = options.version ?? "0.1.0-alpha.10";
  const macosPaths = resolveMacosPreviewEvidencePaths(version, releaseRoot);
  await Promise.all([
    mkdir(unpacked, { recursive: true }),
    mkdir(join(macosPaths.applicationPath, "Contents/MacOS"), { recursive: true }),
    mkdir(join(macosPaths.applicationPath, "Contents/Resources"), { recursive: true })
  ]);
  const installerPath = join(releaseRoot, `New-Money-${version}-win-x64.exe`);
  const executablePath = join(unpacked, "New Money.exe");
  await Promise.all([
    writeFile(installerPath, "installer"),
    writeFile(executablePath, "executable"),
    writeFile(macosPaths.dmgPath, "dmg"),
    writeFile(macosPaths.zipPath, "zip"),
    writeFile(macosPaths.executablePath, "macos-executable"),
    writeFile(macosPaths.appAsarPath, "macos-asar")
  ]);
  await writeMacosPreviewCandidateEvidence({
    host: { platform: "darwin", architecture: "arm64" },
    paths: macosPaths,
    releaseRoot,
    repository: "bigKING67/pi-67-desktop",
    runtimeSpecifier: "@earendil-works/pi-coding-agent@0.81.1",
    source: { policy: "main", commit: "a".repeat(40), clean: true },
    verifyContainers: async () => undefined,
    version
  });
  const identity = await createWindowsPreviewCandidateIdentity({
    host: { platform: "win32", architecture: "x64" },
    installerPath,
    packagedExecutablePath: executablePath,
    releaseRoot,
    repository: "bigKING67/pi-67-desktop",
    runAttempt: "2",
    runId: "42",
    runtimeSpecifier: "@earendil-works/pi-coding-agent@0.81.1",
    sourceCommit: "a".repeat(40),
    version
  });
  const candidateIdentityPath = join(releaseRoot, "windows-preview-candidate-identity.json");
  const outputPath = join(releaseRoot, "windows-preview-manual-test.json");
  const runMetadataPath = join(root, "candidate-run.json");
  await Promise.all([
    writeFile(candidateIdentityPath, JSON.stringify(identity)),
    writeFile(runMetadataPath, JSON.stringify({
      id: 42,
      run_attempt: 2,
      name: "Windows candidate",
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      repository: { full_name: "bigKING67/pi-67-desktop" }
    }))
  ]);
  return {
    root,
    releaseRoot,
    runMetadataPath,
    version,
    promotionOptions: {
      actor: "bigKING67",
      candidateIdentityPath,
      candidateRunAttempt: "2",
      candidateRunId: "42",
      candidateRunMetadataPath: runMetadataPath,
      installerPath,
      outputPath,
      packagedExecutablePath: executablePath,
      promotionRunAttempt: "1",
      promotionRunId: "99",
      repository: "bigKING67/pi-67-desktop",
      sourceCommit: "a".repeat(40)
    }
  };
}
