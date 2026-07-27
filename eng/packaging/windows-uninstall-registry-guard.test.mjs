import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const guardUrl = new URL("./windows-uninstall-registry-guard.ps1", import.meta.url);

describe("Windows uninstall Registry guard", () => {
  it("audits only entries whose InstallLocation exactly matches the bounded install root", async () => {
    const source = await readFile(guardUrl, "utf8");

    expect(source).toContain("'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'");
    expect(source).toContain("'InstallLocation'");
    expect(source).toContain("$null -ne $_.InstallLocation -and $_.InstallLocation.Equals(");
    expect(source).toContain("$ExpectedInstallRoot,");
    expect(source).toContain("RegistryHive]::CurrentUser");
    expect(source).toContain("RegistryHive]::LocalMachine");
    expect(source).toContain("RegistryView]::Registry64");
    expect(source).toContain("RegistryView]::Registry32");
    expect(source).toContain("requires bounded GitHub run identity");
    expect(source).not.toContain("DisplayName");
    expect(source).not.toContain("UninstallString");
    expect(source).not.toContain("Pi-67 Desktop");
  });

  it("diffs against the pre-install snapshot and removes only revalidated new entries", async () => {
    const source = await readFile(guardUrl, "utf8");
    const cleanup = source.slice(source.indexOf("$cleanupFailure = $null"));

    expect(source).toContain("baselineEntryIdentities");
    expect(source).toContain("Get-NewEntries $currentEntries $baselineIdentities");
    expect(source).toContain("Get-EntriesByIdentity $allCurrentEntries $observedNewEntryIdentities");
    expect(source).toContain("Observed uninstall Registry entries changed InstallLocation and were not removed");
    expect(source).toContain("$currentLocation.Equals(");
    expect(source).toContain("Refusing to remove uninstall Registry entry whose InstallLocation changed");
    expect(cleanup).toContain("foreach ($entry in $newEntries)");
    expect(cleanup).toContain("Remove-ExactEntry $entry $paths.InstallRoot");
    expect(cleanup).toContain("Get-ExactInstallEntries $remainingAllEntries $paths.InstallRoot");
    expect(cleanup).toContain("if ($remainingIdentities.Count -gt 0)");
    expect(cleanup).toContain("if ($newIdentities.Count -gt 0 -and $null -eq $cleanupFailure)");
    expect(cleanup).toContain("exact bounded entries were removed");
  });

  it("logs only scoped hashed Registry key identities", async () => {
    const source = await readFile(guardUrl, "utf8");

    expect(source).toContain("Get-Sha256 $identitySource");
    expect(source).toContain("$($location.HiveIdentity):$($location.ViewIdentity):");
    expect(source).not.toMatch(/Write-(?:Host|Output)[^\n]*(?:InstallLocation|SubKeyName|DisplayName)/u);
  });

  it("has valid PowerShell syntax on Windows", async () => {
    if (process.platform !== "win32") return;
    const guardPath = fileURLToPath(guardUrl);
    const result = spawnSync("pwsh", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      POWER_SHELL_PARSE_COMMAND
    ], {
      encoding: "utf8",
      env: { ...process.env, PI67_WINDOWS_REGISTRY_GUARD_PATH: guardPath },
      maxBuffer: 256 * 1024
    });

    if (result.error) throw result.error;
    expect(result.status, `${result.stderr || result.stdout}`).toBe(0);
  });
});

const POWER_SHELL_PARSE_COMMAND = `
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  $env:PI67_WINDOWS_REGISTRY_GUARD_PATH,
  [ref]$tokens,
  [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) {
  foreach ($parseError in $errors) {
    [Console]::Error.WriteLine($parseError.Message)
  }
  exit 1
}
`;
