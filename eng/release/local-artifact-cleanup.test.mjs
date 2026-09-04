import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyLocalArtifactCleanup,
  parseLocalArtifactCleanupArguments,
  planLocalArtifactCleanup
} from "./local-artifact-cleanup.mjs";

const temporaryDirectories = [];

describe("local release artifact cleanup", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  it("plans only recognized binary payloads while preserving release evidence", async () => {
    const root = await fixtureRepository();
    const plan = await planLocalArtifactCleanup({ root });

    expect(plan.targets.map((target) => target.relativePath)).toEqual([
      "artifacts/candidates/windows-alpha37-123/candidate/release/Pi-67-Desktop-0.1.0-alpha.37-win-x64.exe",
      "artifacts/candidates/windows-alpha37-123/candidate/release/win-unpacked",
      "artifacts/r2-update-bundle/Pi-67-Desktop-0.1.0-alpha.40-mac-arm64-unsigned-preview.dmg",
      "artifacts/release/.icon-icns",
      "artifacts/release/builder-debug.yml",
      "artifacts/release/latest-mac.yml",
      "artifacts/release/mac-arm64",
      "artifacts/release/Pi-67-Desktop-0.1.0-alpha.40-mac-arm64.dmg",
      "artifacts/release/win-unpacked",
      "artifacts/validation/alpha29-windows-candidate/release/Pi-67-Desktop-0.1.0-alpha.29-win-x64.exe",
      "artifacts/validation/alpha29-windows-candidate/release/win-unpacked",
      "artifacts/verified-unsigned-preview/Pi-67-Desktop-0.1.0-alpha.40-win-x64-unsigned-preview.exe",
      "artifacts/windows-candidate-456-1/release/Pi-67-Desktop-0.1.0-alpha.40-win-x64.exe",
      "artifacts/windows-candidate-456-1/release/win-unpacked"
    ]);
    expect(plan.bytes).toBeGreaterThan(0);
    await expect(readFile(join(root, "artifacts/release/unsigned-preview-manifest.json"), "utf8"))
      .resolves.toBe("manifest");
    await expect(readFile(join(root, "artifacts/r2-release-receipts/publish.json"), "utf8"))
      .resolves.toBe("receipt");
    await expect(readFile(join(root, "artifacts/unrelated/Pi-67-Desktop-0.1.0-alpha.1-win-x64.exe"), "utf8"))
      .resolves.toBe("unrelated");
  });

  it("requires exact confirmation and refuses while the repository preview is running", async () => {
    const root = await fixtureRepository();

    await expect(applyLocalArtifactCleanup({ root })).rejects.toThrow("requires --confirm");
    await expect(applyLocalArtifactCleanup({
      confirmed: true,
      probeRunningProcesses: async () => ["pid=42"],
      root
    })).rejects.toThrow("pid=42");
    expect((await planLocalArtifactCleanup({ root })).targets.length).toBeGreaterThan(0);
  });

  it("deletes the planned payloads and leaves evidence and unrelated files", async () => {
    const root = await fixtureRepository();
    const result = await applyLocalArtifactCleanup({
      confirmed: true,
      probeRunningProcesses: async () => [],
      root
    });

    expect(result.removed).toHaveLength(result.before.targets.length);
    expect(result.after.targets).toEqual([]);
    await expect(access(join(root, "artifacts/release/mac-arm64"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, "artifacts/release/macos-preview-candidate-identity.json"), "utf8"))
      .resolves.toBe("identity");
    await expect(readFile(join(root, "artifacts/windows-candidate-456-1/validation/summary.json"), "utf8"))
      .resolves.toBe("summary");
    await expect(readFile(join(root, "artifacts/unrelated/Pi-67-Desktop-0.1.0-alpha.1-win-x64.exe"), "utf8"))
      .resolves.toBe("unrelated");
  });

  it("fails closed for a recognized artifact symlink", async () => {
    const root = await temporaryDirectory();
    const outside = join(root, "outside.exe");
    const release = join(root, "artifacts/release");
    await mkdir(release, { recursive: true });
    await writeFile(outside, "outside");
    await symlink(outside, join(release, "Pi-67-Desktop-0.1.0-alpha.40-win-x64.exe"));

    await expect(planLocalArtifactCleanup({ root })).rejects.toThrow("not a regular file");
    await expect(readFile(outside, "utf8")).resolves.toBe("outside");
  });

  it("accepts only the bounded CLI contract", () => {
    expect(parseLocalArtifactCleanupArguments([])).toEqual({ confirmed: false, mode: "plan" });
    expect(parseLocalArtifactCleanupArguments(["plan"])).toEqual({ confirmed: false, mode: "plan" });
    expect(parseLocalArtifactCleanupArguments(["apply", "--confirm-local-artifact-cleanup"]))
      .toEqual({ confirmed: true, mode: "apply" });
    expect(parseLocalArtifactCleanupArguments(["--", "apply", "--confirm-local-artifact-cleanup"]))
      .toEqual({ confirmed: true, mode: "apply" });
    expect(() => parseLocalArtifactCleanupArguments(["apply"])).toThrow("Usage");
    expect(() => parseLocalArtifactCleanupArguments(["apply", "--force"])).toThrow("Usage");
  });
});

async function fixtureRepository() {
  const root = await temporaryDirectory();
  const files = new Map([
    ["artifacts/release/Pi-67-Desktop-0.1.0-alpha.40-mac-arm64.dmg", "macos"],
    ["artifacts/release/mac-arm64/Pi-67 Desktop.app/Contents/Resources/app.asar", "asar"],
    ["artifacts/release/win-unpacked/Pi-67 Desktop.exe", "windows"],
    ["artifacts/release/.icon-icns/icon.icns", "icon"],
    ["artifacts/release/builder-debug.yml", "debug"],
    ["artifacts/release/latest-mac.yml", "latest"],
    ["artifacts/release/unsigned-preview-manifest.json", "manifest"],
    ["artifacts/release/macos-preview-candidate-identity.json", "identity"],
    ["artifacts/verified-unsigned-preview/Pi-67-Desktop-0.1.0-alpha.40-win-x64-unsigned-preview.exe", "verified"],
    ["artifacts/verified-unsigned-preview/windows-preview-candidate-identity.json", "identity"],
    ["artifacts/r2-update-bundle/Pi-67-Desktop-0.1.0-alpha.40-mac-arm64-unsigned-preview.dmg", "bundle"],
    ["artifacts/r2-update-bundle/unsigned-preview-manifest.json", "manifest"],
    ["artifacts/candidates/windows-alpha37-123/candidate/release/Pi-67-Desktop-0.1.0-alpha.37-win-x64.exe", "candidate"],
    ["artifacts/candidates/windows-alpha37-123/candidate/release/win-unpacked/Pi-67 Desktop.exe", "unpacked"],
    ["artifacts/candidates/windows-alpha37-123/candidate/validation/summary.json", "summary"],
    ["artifacts/windows-candidate-456-1/release/Pi-67-Desktop-0.1.0-alpha.40-win-x64.exe", "candidate"],
    ["artifacts/windows-candidate-456-1/release/win-unpacked/Pi-67 Desktop.exe", "unpacked"],
    ["artifacts/windows-candidate-456-1/validation/summary.json", "summary"],
    ["artifacts/validation/alpha29-windows-candidate/release/Pi-67-Desktop-0.1.0-alpha.29-win-x64.exe", "candidate"],
    ["artifacts/validation/alpha29-windows-candidate/release/win-unpacked/Pi-67 Desktop.exe", "unpacked"],
    ["artifacts/validation/alpha29-windows-candidate/validation/summary.json", "summary"],
    ["artifacts/r2-release-receipts/publish.json", "receipt"],
    ["artifacts/unrelated/Pi-67-Desktop-0.1.0-alpha.1-win-x64.exe", "unrelated"]
  ]);
  for (const [relativePath, content] of files) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-local-artifact-cleanup-"));
  temporaryDirectories.push(path);
  return path;
}
