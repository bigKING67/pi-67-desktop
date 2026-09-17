import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { rcompare, valid } from "semver";

const execute = promisify(execFile);
const defaultRoot = fileURLToPath(new URL("../../artifacts/release", import.meta.url));
const archiveName = /^(?:New-Money|Pi-67-Desktop)-(.+)-(mac-arm64|win-x64)(?:-unsigned-preview)?\.(dmg|zip|exe)(?:\.blockmap)?$/u;

// Serialize the producer and retention for the fixed release directory.
export async function withReleaseArchiveLock(releaseRoot, callback) {
  await mkdir(releaseRoot, { recursive: true });
  if (await realpath(releaseRoot) !== resolve(releaseRoot)) throw new Error("Release directory must be canonical.");
  const path = join(releaseRoot, ".archive-retention.lock");
  let lock;
  try { lock = await open(path, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("Release archive operation is locked; inspect the active operation or stale lock.");
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    return await callback(options => maintainReleaseArchives({ ...options, releaseRoot, apply: true, lockHeld: true }));
  } finally { await lock.close(); await rm(path); }
}

export async function planReleaseArchiveRetention({ releaseRoot = defaultRoot, currentVersion } = {}) {
  if (currentVersion !== undefined && !valid(currentVersion)) throw new Error("Invalid current release version.");
  const rootStat = await optionalStat(releaseRoot);
  if (!rootStat) return { targets: [], retained: [], bytes: 0 };
  if (!rootStat.isDirectory() || await realpath(releaseRoot) !== resolve(releaseRoot)) throw new Error("Unsafe release directory.");
  const states = await readBuildStates(releaseRoot);
  const files = [];
  for (const name of await readdir(releaseRoot)) {
    const match = name.match(archiveName);
    if (!match || !valid(match[1]) || (match[2] === "win-x64") !== (match[3] === "exe")) continue;
    const path = join(releaseRoot, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe archive: ${name}`);
    files.push({ name, path, version: match[1], platform: match[2], bytes: stat.size,
      inode: stat.ino, device: stat.dev, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
      state: states[`${match[2]}/${match[1]}`] ?? "COMPLETE",
      pinned: Boolean(await optionalStat(`${path}.keep`)) });
  }
  const targets = []; const retained = [];
  for (const platform of ["mac-arm64", "win-x64"]) {
    const group = files.filter(file => file.platform === platform);
    const versions = [...new Set(group.filter(file => file.state === "COMPLETE").map(file => file.version))].sort(rcompare);
    const failedVersions = [...new Set(group.filter(file => file.state !== "COMPLETE").map(file => file.version))].sort(rcompare);
    const keep = new Set([...new Set([...(currentVersion && versions.includes(currentVersion) ? [currentVersion] : []), ...versions])].slice(0, 2));
    if (failedVersions[0]) keep.add(failedVersions.includes(currentVersion) ? currentVersion : failedVersions[0]);
    // Pinning any member preserves the entire version set, including blockmaps.
    const pins = new Set(group.filter(file => file.pinned).map(file => file.version));
    for (const file of group) (keep.has(file.version) || pins.has(file.version) ? retained : targets).push(file);
  }
  return { targets, retained, bytes: targets.reduce((total, file) => total + file.bytes, 0) };
}

export async function maintainReleaseArchives({ releaseRoot = defaultRoot, currentVersion, apply = false,
  lockHeld = false, probeInUse = archivePathsInUse } = {}) {
  if (apply && !lockHeld) return withReleaseArchiveLock(releaseRoot,
    retain => retain({ currentVersion, probeInUse }));
  const plan = await planReleaseArchiveRetention({ releaseRoot, currentVersion });
  if (!apply || plan.targets.length === 0) return { ...plan, removed: [] };
  const busy = new Set(await probeInUse(plan.targets.map(file => file.path)));
  if (busy.size) throw new Error("Old release archives are in use; retention did not delete any files.");
  // Validate the whole selected set before the first unlink, then each file again.
  for (const target of plan.targets) await assertArchiveUnchanged(target);
  for (const target of plan.targets) { await assertArchiveUnchanged(target); await rm(target.path); }
  return { ...plan, removed: plan.targets.map(file => file.name) };
}

// A failed build may leave one additional version. Do not start a fourth version
// when failures/pins prevented normal two-version retention; preserve all evidence.
export async function assertReleaseArchiveCapacity(releaseRoot, currentVersion, platform) {
  const plan = await planReleaseArchiveRetention({ releaseRoot, currentVersion });
  const files = [...plan.targets, ...plan.retained].filter(file => file.platform === platform);
  const versions = new Set(files.map(file => file.version));
  const completed = new Set(files.filter(file => file.state === "COMPLETE").map(file => file.version));
  const failed = new Set(files.filter(file => file.state !== "COMPLETE").map(file => file.version));
  if (!versions.has(currentVersion) && (completed.size >= 3 || failed.size >= 2)) {
    throw new Error("Release archive capacity exhausted by retained or failed versions; inspect release:local:retain before starting another version.");
  }
}

export async function recordReleaseBuildState(releaseRoot, version, platform, state) {
  if (!valid(version) || !["mac-arm64", "win-x64"].includes(platform) || !["BUILDING", "COMPLETE", "FAILED"].includes(state)) {
    throw new Error("Invalid release build state.");
  }
  const states = await readBuildStates(releaseRoot);
  states[`${platform}/${version}`] = state;
  const path = join(releaseRoot, "archive-build-status.json");
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify({ schema: "pi67.archive-build-status.v1", states }, null, 2)); }
  finally { await handle.close(); }
}

async function readBuildStates(releaseRoot) {
  const path = join(releaseRoot, "archive-build-status.json");
  const stat = await optionalStat(path);
  if (!stat) return {};
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("Unsafe release build status.");
  const record = JSON.parse(await readFile(path, "utf8"));
  if (record.schema !== "pi67.archive-build-status.v1" || !record.states || Array.isArray(record.states)
    || typeof record.states !== "object" || Object.entries(record.states).some(([key, value]) => {
      const [platform, version, extra] = key.split("/");
      return extra !== undefined || !["mac-arm64", "win-x64"].includes(platform) || !valid(version)
        || !["BUILDING", "COMPLETE", "FAILED"].includes(value);
    })) throw new Error("Invalid release build status.");
  return record.states;
}

async function assertArchiveUnchanged(file) {
  const stat = await lstat(file.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.ino !== file.inode || stat.dev !== file.device
    || stat.size !== file.bytes || stat.mtimeMs !== file.mtimeMs || stat.ctimeMs !== file.ctimeMs
    || await optionalStat(`${file.path}.keep`)) throw new Error("Release archive changed or was pinned after planning.");
}

async function archivePathsInUse(paths) {
  if (process.platform === "darwin") {
    let stdout;
    try { ({ stdout } = await execute("/usr/sbin/lsof", ["-nP", "-Fn"], { maxBuffer: 32 * 1024 * 1024, timeout: 15_000 })); }
    catch (error) { if (error.code === 1 && !error.stdout && !error.stderr) return []; throw error; }
    const opened = new Set(stdout.split("\n").filter(line => line.startsWith("n")).map(line => line.slice(1)));
    return paths.filter(path => opened.has(path));
  }
  if (process.platform === "win32") {
    const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object -ExpandProperty ExecutablePath"], { maxBuffer: 4 * 1024 * 1024, timeout: 15_000 });
    const opened = new Set(stdout.split(/\r?\n/u).map(path => path.trim().toLowerCase()));
    return paths.filter(path => opened.has(path.toLowerCase()));
  }
  throw new Error("Archive retention requires a supported host process probe.");
}

async function optionalStat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(arg => arg !== "--");
  if (args.length && !(args.length === 2 && args[0] === "apply" && args[1] === "--confirm-local-artifact-retention")) {
    throw new Error("Usage: release-archive-retention.mjs [apply --confirm-local-artifact-retention]");
  }
  const result = await maintainReleaseArchives({ apply: args.length > 0 });
  for (const file of result.targets) console.log(`${args.length ? "REMOVED" : "ELIGIBLE"} ${file.name} (${file.bytes} bytes)`);
  console.log(`Release archive retention: removed=${result.removed.length}; retained=${result.retained.length}; eligibleBytes=${result.bytes}; applications/evidence preserved.`);
}
