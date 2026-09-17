import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { packageWithRetention } from "./package-with-retention.mjs";

async function writeStoragePolicy(root, highWarning = false) {
  await mkdir(join(root, "eng/packaging"), { recursive: true });
  const policy = JSON.parse(await readFile(new URL("./local-storage-policy.json", import.meta.url), "utf8"));
  if (highWarning) { policy.warningBytes = 1; policy.strongWarningBytes = 2; }
  await writeFile(join(root, "eng/packaging/local-storage-policy.json"), JSON.stringify(policy));
}

it("runs the package command under a lock, prunes after success and preserves output after build failure", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "package-retention-")));
  try {
    await writeStoragePolicy(sourceRoot);
    const release = join(sourceRoot, "artifacts/release"); await mkdir(release, { recursive: true });
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ version: "1.0.2" }));
    for (const version of ["1.0.0", "1.0.1"]) await writeFile(join(release, `New-Money-${version}-mac-arm64.zip`), version);
    const args = ["--mac", "dmg", "zip", "--arm64"];
    const build = vi.fn(async () => {
      expect(JSON.parse(await readFile(join(release, ".archive-retention.lock"), "utf8")).pid).toBe(process.pid);
      expect(JSON.parse(await readFile(join(sourceRoot, "artifacts/.storage-budget.lock"), "utf8")).operation).toBe("desktopPackaging");
      await writeFile(join(release, "New-Money-1.0.2-mac-arm64.zip"), "new");
    });
    const result = await packageWithRetention(args, { sourceRoot, build, probeInUse: async () => [] });
    expect(build).toHaveBeenCalledWith(args, sourceRoot);
    expect(result.removed).toEqual(["New-Money-1.0.0-mac-arm64.zip"]);
    const before = await readdir(release);
    await expect(packageWithRetention(args, { sourceRoot, build: async () => { throw new Error("build failed"); } })).rejects.toThrow("build failed");
    expect(await readdir(release)).toEqual(before);
  } finally { await rm(sourceRoot, { recursive: true, force: true }); }
});

it("does not let repeated failed versions evict the last successful rollback", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "package-failed-retention-")));
  try {
    await writeStoragePolicy(sourceRoot);
    const release = join(sourceRoot, "artifacts/release"); await mkdir(release, { recursive: true });
    const buildVersion = async (version, failed) => {
      await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ version }));
      return packageWithRetention(["--mac"], { sourceRoot, probeInUse: async () => [], build: async () => {
        await writeFile(join(release, `New-Money-${version}-mac-arm64.zip`), failed ? "partial" : "complete");
        if (failed) throw new Error("failed archive");
      } });
    };
    await buildVersion("1.0.0", false);
    for (const version of ["1.0.1", "1.0.2", "1.0.3", "1.0.4"]) await expect(buildVersion(version, true)).rejects.toThrow("failed archive");
    expect((await readdir(release)).filter(name => name.endsWith(".zip")).sort((a,b) => a.localeCompare(b)))
      .toEqual(["New-Money-1.0.0-mac-arm64.zip", "New-Money-1.0.4-mac-arm64.zip"]);
    expect(await readFile(join(release, "New-Money-1.0.0-mac-arm64.zip"), "utf8")).toBe("complete");
  } finally { await rm(sourceRoot, { recursive: true, force: true }); }
});

it("allows packaging over the warning threshold and preserves successful release state and rollback", async () => {
  const sourceRoot = await realpath(await mkdtemp(join(tmpdir(), "package-storage-advisory-")));
  try {
    await writeStoragePolicy(sourceRoot, true);
    const release = join(sourceRoot, "artifacts/release"); await mkdir(release, { recursive: true });
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ version: "1.0.2" }));
    await writeFile(join(release, "New-Money-1.0.0-mac-arm64.zip"), "rollback");
    const build = vi.fn(async () => { await writeFile(join(release, "New-Money-1.0.2-mac-arm64.zip"), "complete"); });
    await packageWithRetention(["--mac"], { sourceRoot, build, probeInUse: async () => [] });
    expect(build).toHaveBeenCalledOnce();
    expect(await readFile(join(release, "New-Money-1.0.2-mac-arm64.zip"), "utf8")).toBe("complete");
    expect(await readFile(join(release, "archive-build-status.json"), "utf8")).toContain("COMPLETE");
    expect(await readdir(join(sourceRoot, "artifacts"))).toEqual(["release"]);
    expect(await readFile(join(release, "New-Money-1.0.0-mac-arm64.zip"), "utf8")).toBe("rollback");
  } finally { await rm(sourceRoot, { recursive: true, force: true }); }
});
