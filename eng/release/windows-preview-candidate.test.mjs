import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWindowsPreviewCandidateIdentity,
  createWindowsPreviewCandidateIdentity,
  verifyWindowsPreviewCandidateFiles
} from "./windows-preview-candidate.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Windows preview candidate identity", () => {
  it("binds the exact unsigned installer and packaged executable bytes", async () => {
    const fixture = await candidateFixture();
    const result = await verifyWindowsPreviewCandidateFiles({
      candidateIdentityPath: fixture.identityPath,
      expectedRepository: "bigKING67/pi-67-desktop",
      expectedRunAttempt: "2",
      expectedRunId: "42",
      expectedSourceCommit: "a".repeat(40),
      installerPath: fixture.installerPath,
      packagedExecutablePath: fixture.executablePath
    });
    expect(result.identity).toMatchObject({
      channel: "unsigned-preview-candidate",
      signed: false,
      workflow: { name: "Windows candidate", runId: "42", runAttempt: "2" }
    });
    expect(result.identitySha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects artifact drift and identities that claim to be signed", async () => {
    const fixture = await candidateFixture();
    await writeFile(fixture.installerPath, "changed");
    await expect(verifyWindowsPreviewCandidateFiles({
      candidateIdentityPath: fixture.identityPath,
      expectedRepository: "bigKING67/pi-67-desktop",
      expectedRunAttempt: "2",
      expectedRunId: "42",
      expectedSourceCommit: "a".repeat(40),
      installerPath: fixture.installerPath,
      packagedExecutablePath: fixture.executablePath
    })).rejects.toThrow("bytes do not match");
    const invalid = { ...fixture.identity, signed: true };
    expect(() => assertWindowsPreviewCandidateIdentity(invalid)).toThrow("explicitly unsigned");
  });

  it("requires a Windows x64 build host", async () => {
    const fixture = await fileFixture();
    await expect(createWindowsPreviewCandidateIdentity({
      ...fixture.options,
      host: { platform: "darwin", architecture: "arm64" }
    })).rejects.toThrow("require win32/x64");
  });
});

async function candidateFixture() {
  const fixture = await fileFixture();
  const identity = await createWindowsPreviewCandidateIdentity(fixture.options);
  const identityPath = join(fixture.releaseRoot, "windows-preview-candidate-identity.json");
  await writeFile(identityPath, JSON.stringify(identity));
  return { ...fixture, identity, identityPath };
}

async function fileFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-windows-preview-candidate-"));
  temporaryDirectories.push(root);
  const releaseRoot = join(root, "release");
  const unpacked = join(releaseRoot, "win-unpacked");
  await mkdir(unpacked, { recursive: true });
  const version = "0.1.0-alpha.10";
  const installerPath = join(releaseRoot, `Pi-67-Desktop-${version}-win-x64.exe`);
  const executablePath = join(unpacked, "Pi-67 Desktop.exe");
  await Promise.all([
    writeFile(installerPath, "installer"),
    writeFile(executablePath, "executable")
  ]);
  return {
    executablePath,
    installerPath,
    releaseRoot,
    options: {
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
    }
  };
}
