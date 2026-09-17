import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReleaseArchiveCapacity, recordReleaseBuildState, withReleaseArchiveLock } from "../release/release-archive-retention.mjs";
import { withRepositoryStorageBudget } from "./local-storage-budget.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Preserve the signed package commands' electron-builder arguments/environment.
export async function packageWithRetention(args, { sourceRoot = root, build = runBuilder, probeInUse } = {}) {
  return withRepositoryStorageBudget({ sourceRoot, operation: "desktopPackaging" }, () =>
    withReleaseArchiveLock(resolve(sourceRoot, "artifacts/release"), async retain => {
      const { version } = JSON.parse(await readFile(resolve(sourceRoot, "package.json"), "utf8"));
      const platform = args.includes("--mac") ? "mac-arm64" : args.includes("--win") ? "win-x64" : undefined;
      if (!platform) throw new Error("Expected explicit --mac or --win package target.");
      await assertReleaseArchiveCapacity(resolve(sourceRoot, "artifacts/release"), version, platform);
      const releaseRoot = resolve(sourceRoot, "artifacts/release");
      await recordReleaseBuildState(releaseRoot, version, platform, "BUILDING");
      try { await build(args, sourceRoot); }
      catch (error) {
        await recordReleaseBuildState(releaseRoot, version, platform, "FAILED");
        await retain({ currentVersion: version, probeInUse });
        throw error;
      }
      await recordReleaseBuildState(releaseRoot, version, platform, "COMPLETE");
      const result = await retain({ currentVersion: version, probeInUse });
      console.log(`Release archives: removed=${result.removed.length}; retained=${result.retained.length}; applications preserved.`);
      return result;
    }));
}

async function runBuilder(args, sourceRoot) {
  // Resource copies belong inside the same budget reservation as packaging.
  const { prepareDesktopToolchain } = await import("./prepare-toolchain.mjs");
  const { prepareDesktopCapabilities } = await import("../capabilities/prepare-capabilities.mjs");
  const platform = args.includes("--mac") ? "darwin" : "win32";
  const arch = platform === "darwin" ? "arm64" : "x64";
  await prepareDesktopToolchain(platform, arch);
  await prepareDesktopCapabilities();
  if (platform === "win32") {
    const { prepareWindowsJobController } = await import("./prepare-windows-job-controller.mjs");
    await prepareWindowsJobController(platform, arch);
  }
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(sourceRoot, "node_modules/electron-builder/out/cli/cli.js"), ...args],
      { cwd: sourceRoot, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`electron-builder failed (${signal ?? code}).`));
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageWithRetention(process.argv.slice(2));
}
