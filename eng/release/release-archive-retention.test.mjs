import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertReleaseArchiveCapacity, maintainReleaseArchives, planReleaseArchiveRetention, recordReleaseBuildState, withReleaseArchiveLock } from "./release-archive-retention.mjs";

const roots = [];
async function fixture() {
  const releaseRoot = await realpath(await mkdtemp(join(tmpdir(), "release-retention-"))); roots.push(releaseRoot);
  const add = async (version, platform = "mac-arm64") => {
    const suffixes = platform === "mac-arm64" ? ["dmg", "zip", "dmg.blockmap", "zip.blockmap"] : ["exe"];
    for (const suffix of suffixes) await writeFile(join(releaseRoot, `New-Money-${version}-${platform}.${suffix}`), version);
  };
  const apply = options => maintainReleaseArchives({ releaseRoot, apply: true, probeInUse: async () => [], ...options });
  return { releaseRoot, add, apply };
}
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });

describe("release archive retention", () => {
  it("keeps the latest two versions per platform including all container companions", async () => {
    const { releaseRoot, add, apply } = await fixture();
    await mkdir(join(releaseRoot, "mac-arm64")); await writeFile(join(releaseRoot, "mac-arm64/running-app"), "live");
    await writeFile(join(releaseRoot, "candidate-identity.json"), "evidence");
    for (const version of ["0.1.0-alpha.9", "0.1.0-alpha.10", "0.1.0-alpha.11"]) await add(version);
    await add("0.1.0-alpha.9", "win-x64"); await add("0.1.0-alpha.10", "win-x64");
    const result = await apply({ currentVersion: "0.1.0-alpha.11" });
    expect(result.removed).toHaveLength(4);
    expect(result.removed.every(name => name.includes("alpha.9-mac"))).toBe(true);
    expect(await readFile(join(releaseRoot, "mac-arm64/running-app"), "utf8")).toBe("live");
    expect(await readFile(join(releaseRoot, "candidate-identity.json"), "utf8")).toBe("evidence");
    expect((await apply()).removed).toEqual([]);
  });

  it("bounds repeated version changes and preserves an explicitly selected older current build", async () => {
    const { releaseRoot, add, apply } = await fixture();
    for (let version = 1; version <= 6; version++) { await add(`1.0.${version}`); await apply({ currentVersion: `1.0.${version}` }); }
    expect(await readdir(releaseRoot)).toHaveLength(8);
    await add("1.0.0"); await apply({ currentVersion: "1.0.0" });
    const remaining = await readdir(releaseRoot);
    expect(remaining).toHaveLength(8);
    expect(remaining.every(name => name.includes("1.0.0") || name.includes("1.0.6"))).toBe(true);
  });

  it("stops a fourth version after repeated build failures before allocating more output", async () => {
    const { releaseRoot, add } = await fixture();
    for (const version of ["1.0.0", "1.1.0", "1.2.0"]) await add(version);
    await expect(assertReleaseArchiveCapacity(releaseRoot, "1.3.0", "mac-arm64")).rejects.toThrow("capacity exhausted");
    await expect(assertReleaseArchiveCapacity(releaseRoot, "1.2.0", "mac-arm64")).resolves.toBeUndefined();
    await expect(assertReleaseArchiveCapacity(releaseRoot, "1.3.0", "win-x64")).resolves.toBeUndefined();
    expect(await readdir(releaseRoot)).toHaveLength(12);
  });

  it("keeps successful rollback versions separately from the latest failed archive set", async () => {
    const { releaseRoot, add, apply } = await fixture();
    for (const version of ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]) await add(version);
    await recordReleaseBuildState(releaseRoot, "1.2.0", "mac-arm64", "FAILED");
    await recordReleaseBuildState(releaseRoot, "1.3.0", "mac-arm64", "FAILED");
    const result = await apply({ currentVersion: "1.3.0" });
    expect(result.removed).toHaveLength(4);
    expect(result.removed.every(name => name.includes("1.2.0"))).toBe(true);
    expect(result.retained.filter(file => file.state === "COMPLETE")).toHaveLength(8);
  });

  it("pins entire version groups and excludes unknown files", async () => {
    const { releaseRoot, add, apply } = await fixture();
    for (const version of ["1.0.0", "1.1.0", "1.2.0"]) await add(version);
    await writeFile(join(releaseRoot, "New-Money-1.0.0-mac-arm64.zip.keep"), "pinned");
    await writeFile(join(releaseRoot, "New-Money-not-a-version-mac-arm64.zip"), "unknown");
    expect((await apply()).removed).toEqual([]);
    expect(await readFile(join(releaseRoot, "New-Money-1.0.0-mac-arm64.dmg"), "utf8")).toBe("1.0.0");
  });

  it("refuses an occupied or changed archive before deleting any selected files", async () => {
    const { releaseRoot, add, apply } = await fixture();
    for (const version of ["1.0.0", "1.1.0", "1.2.0"]) await add(version);
    await expect(apply({ probeInUse: async paths => [paths[0]] })).rejects.toThrow("in use");
    expect(await readdir(releaseRoot)).toHaveLength(12);
    await expect(apply({ probeInUse: async paths => { await writeFile(paths[0], "changed"); return []; } })).rejects.toThrow("changed");
    expect(await readdir(releaseRoot)).toHaveLength(12);
  });

  it("blocks concurrent producers and never follows archive symlinks", async () => {
    const { releaseRoot, add, apply } = await fixture();
    await withReleaseArchiveLock(releaseRoot, async () => {
      await expect(apply()).rejects.toThrow("locked");
    });
    await add("1.0.0");
    const target = join(releaseRoot, "New-Money-1.0.0-mac-arm64.dmg");
    await symlink(target, join(releaseRoot, "New-Money-0.0.1-mac-arm64.dmg"));
    await expect(planReleaseArchiveRetention({ releaseRoot })).rejects.toThrow("Unsafe archive");
    expect(await readFile(target, "utf8")).toBe("1.0.0");
  });
});
