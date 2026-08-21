import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareUnsignedPreviewBundle, unsignedPreviewBundleFiles } from "./prepare-unsigned-preview-bundle.mjs";
import { prepareUnsignedPreview } from "./unsigned-preview-artifacts.mjs";
import { createWindowsPreviewCandidateIdentity } from "./windows-preview-candidate.mjs";
import { parseWindowsPreviewManualTestArguments } from "./windows-preview-manual-test.mjs";
import {
  WINDOWS_PREVIEW_OPERATOR_MANUAL_TEST_SCHEMA,
  recordWindowsPreviewManualTest,
  verifyWindowsPreviewPromotion
} from "./windows-preview-promotion.mjs";

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
      candidate: { runId: "42", runAttempt: "2" }
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
      candidate: { runId: "42", runAttempt: "2" },
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

async function promotionFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-windows-preview-promotion-"));
  temporaryDirectories.push(root);
  const releaseRoot = join(root, "release");
  const unpacked = join(releaseRoot, "win-unpacked");
  await mkdir(unpacked, { recursive: true });
  const version = "0.1.0-alpha.10";
  const installerPath = join(releaseRoot, `Pi-67-Desktop-${version}-win-x64.exe`);
  const executablePath = join(unpacked, "Pi-67 Desktop.exe");
  await Promise.all([
    writeFile(installerPath, "installer"),
    writeFile(executablePath, "executable"),
    writeFile(join(releaseRoot, `Pi-67-Desktop-${version}-mac-arm64.dmg`), "dmg"),
    writeFile(join(releaseRoot, `Pi-67-Desktop-${version}-mac-arm64.zip`), "zip")
  ]);
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
