import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPreservedUserData,
  buildNsisInstallArguments,
  resolveExpectedLifecycleSigner,
  resolveUpgradeBaselineInstaller,
  resolveWindowsInstallerPath,
  waitForPathState
} from "./verify-windows-installer-lifecycle.mjs";

const temporaryDirectories = [];
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("Windows installer lifecycle contract", () => {
  it("resolves the exact current-version x64 NSIS artifact", () => {
    expect(resolveWindowsInstallerPath("C:\\release", "0.1.0-alpha.3"))
      .toBe(join("C:\\release", "Pi-67-Desktop-0.1.0-alpha.3-win-x64.exe"));
    expect(() => resolveWindowsInstallerPath("C:\\release", "latest"))
      .toThrow("Invalid package version");
  });

  it("keeps the silent NSIS destination argument last and rejects control characters", () => {
    expect(buildNsisInstallArguments("C:\\Pi-67 Desktop 中文"))
      .toEqual(["/S", "/D=C:\\Pi-67 Desktop 中文"]);
    expect(() => buildNsisInstallArguments("C:\\Pi-67\nDesktop"))
      .toThrow("single-line path");
  });

  it("accepts only an older exact Windows x64 installer as the upgrade baseline", () => {
    expect(resolveUpgradeBaselineInstaller(
      "C:\\release\\Pi-67-Desktop-0.1.0-alpha.2-win-x64.exe",
      "0.1.0-alpha.3"
    )).toMatchObject({ version: "0.1.0-alpha.2" });
    expect(resolveUpgradeBaselineInstaller(
      "C:\\release\\Pi-67-Desktop-0.1.0-alpha.1-win-x64-unsigned-preview.exe",
      "0.1.0-alpha.3"
    )).toMatchObject({ version: "0.1.0-alpha.1" });
    expect(() => resolveUpgradeBaselineInstaller(
      "C:\\release\\Pi-67-Desktop-0.1.0-alpha.3-win-x64.exe",
      "0.1.0-alpha.3"
    )).toThrow("must be an older");
    expect(() => resolveUpgradeBaselineInstaller("C:\\release\\other.exe", "0.1.0-alpha.3"))
      .toThrow("must be an older");
  });

  it("requires a canonical expected Publisher when signed lifecycle verification is enabled", () => {
    expect(resolveExpectedLifecycleSigner(undefined)).toBeUndefined();
    expect(resolveExpectedLifecycleSigner("ab".repeat(20))).toBe("AB".repeat(20));
    expect(() => resolveExpectedLifecycleSigner("not-a-thumbprint"))
      .toThrow("40 hexadecimal");
  });

  it("requires non-empty user data after uninstall", async () => {
    const root = await createTemporaryDirectory();
    const userData = join(root, "user-data");
    await mkdir(userData);
    await expect(assertPreservedUserData(userData)).rejects.toThrow("removed or emptied");
    await writeFile(join(userData, "Local State"), "{}", "utf8");
    await expect(assertPreservedUserData(userData)).resolves.toEqual(["Local State"]);
  });

  it("keeps the installer per-user and preserves application data on uninstall", async () => {
    const builder = await readFile(join(repositoryRoot, "electron-builder.yml"), "utf8");
    expect(builder).toMatch(/nsis:[\s\S]*?oneClick:\s*false/u);
    expect(builder).toMatch(/nsis:[\s\S]*?perMachine:\s*false/u);
    expect(builder).toMatch(/nsis:[\s\S]*?allowToChangeInstallationDirectory:\s*true/u);
    expect(builder).toMatch(/nsis:[\s\S]*?deleteAppDataOnUninstall:\s*false/u);
  });

  it("waits for a path to become present or absent", async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, "artifact.exe");
    setTimeout(() => {
      void writeFile(target, "fixture", "utf8");
    }, 20);
    await expect(waitForPathState(target, true, 1_000)).resolves.toBeUndefined();
    setTimeout(() => {
      void rm(target, { force: true });
    }, 20);
    await expect(waitForPathState(target, false, 1_000)).resolves.toBeUndefined();
  });
});

async function createTemporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-installer-contract-"));
  temporaryDirectories.push(path);
  return path;
}
