import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { withLocalArtifactStorageBudget } from "../packaging/local-storage-budget.mjs";

const execute = promisify(execFile);
const marker = "native-artifact.json";
const schema = "new-money.native-artifact.v1";
const prefixes = { preparation: "preparation-", signed: "signed-local-installation-" };

export async function withNativeArtifactLock(parent, callback) {
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== resolve(parent)) throw new Error("Artifact parent must be canonical, without symlinks.");
  const lockPath = join(parent, ".native-artifacts.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("Native artifact operation is locked; finish the active operation or inspect a stale lock before retrying.");
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await callback();
  } finally { await lock.close(); await rm(lockPath); }
}

// Shared by the two generators. Unknown/legacy directories are never adopted.
// Metadata and pins live outside the signed/measured runtime tree.
export async function runNativeArtifact({ parent, kind, purpose, key, build, validate, pin = false,
  probeInUse = nativeArtifactInUse, report = console.log,
  withBuildBudget = task => withLocalArtifactStorageBudget(parent, kind === "preparation" ? "nativePreparation" : "nativeSigning", task) }) {
  if (!prefixes[kind] || !/^[a-z0-9-]+$/u.test(purpose) || !/^[a-f0-9]{64}$/u.test(key)) {
    throw new Error("Invalid native artifact identity.");
  }
  return withNativeArtifactLock(parent, async () => {
    const entries = (await inspectNativeArtifacts(parent)).filter(entry => entry.kind === kind && entry.purpose === purpose);
    const ready = entries.filter(entry => entry.status === "READY");
    const cached = ready.find(entry => entry.key === key);
    if (cached) {
      await validate(cached.path, cached.value);
      if (pin) await pinArtifact(cached.path);
      report(`Native artifacts: reused=${cached.path}; created=0; retired=0; retained=${entries.length}.`);
      return { ...cached.value, artifactReuse: "VERIFIED_EXISTING" };
    }
    return withBuildBudget(async () => {
      const failed = entries.filter(entry => entry.status === "FAILED" || entry.status === "BUILDING");
      // Reserve enough room for either outcome before copying hundreds of MB.
      const successVictims = await selectVictims(ready, 1, probeInUse);
      const failureVictims = await selectVictims(failed, 0, probeInUse);
      const path = await mkdtemp(join(parent, prefixes[kind]));
      const entry = { schema, kind, purpose, key, status: "BUILDING", createdAt: new Date().toISOString() };
      await writeFile(join(path, marker), JSON.stringify(entry, null, 2), { mode: 0o600 });
      if (pin) await pinArtifact(path);
      let value;
      try {
        value = await build(path);
        await validate(path, value);
      } catch (error) {
        entry.status = "FAILED";
        await writeFile(join(path, marker), JSON.stringify(entry, null, 2));
        for (const victim of failureVictims) await retireNativeArtifact(victim, probeInUse);
        report(`Native artifacts: failed=${path}; previous failed payloads retired=${failureVictims.length}.`);
        throw error;
      }
      entry.status = "READY"; entry.value = value;
      await writeFile(join(path, marker), JSON.stringify(entry, null, 2));
      for (const victim of successVictims) await retireNativeArtifact(victim, probeInUse);
      report(`Native artifacts: created=${path}; retired=${successVictims.length}; retained successful=${ready.length + 1 - successVictims.length}; failed=${failed.length}.`);
      return { ...value, artifactReuse: "CREATED" };
    });
  });
}

export async function inspectNativeArtifacts(parent) {
  const entries = [];
  for (const name of await readdir(parent)) {
    if (!Object.values(prefixes).some(prefix => name.startsWith(prefix))) continue;
    const path = join(parent, name);
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue;
    const recordPath = join(path, marker);
    const recordStat = await optionalStat(recordPath);
    if (!recordStat) continue;
    if (!recordStat.isFile() || recordStat.isSymbolicLink() || recordStat.size > 128 * 1024) {
      throw new Error(`Unsafe native artifact record: ${name}`);
    }
    const entry = JSON.parse(await readFile(recordPath, "utf8"));
    if (entry.schema !== schema || !prefixes[entry.kind] || !name.startsWith(prefixes[entry.kind])
      || !/^[a-z0-9-]+$/u.test(entry.purpose) || !/^[a-f0-9]{64}$/u.test(entry.key)
      || !Number.isFinite(Date.parse(entry.createdAt))
      || !["BUILDING", "READY", "FAILED", "RETIRED"].includes(entry.status)) {
      throw new Error(`Invalid native artifact record: ${name}`);
    }
    if (entry.status !== "RETIRED") entries.push({ ...entry, path, inode: metadata.ino, device: metadata.dev });
  }
  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.path.localeCompare(b.path));
}

async function selectVictims(entries, retain, probeInUse) {
  const needed = Math.max(0, entries.length - retain);
  const victims = [];
  for (const entry of entries) {
    if (victims.length === needed) break;
    if (!await optionalStat(join(entry.path, ".keep")) && !await probeInUse(entry.path)) victims.push(entry);
  }
  if (victims.length !== needed) throw new Error("Native artifact capacity is protected by pins or active use; no new output was created.");
  return victims;
}

async function retireNativeArtifact(entry, probeInUse) {
  const metadata = await lstat(entry.path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.ino !== entry.inode || metadata.dev !== entry.device
    || await optionalStat(join(entry.path, ".keep")) || await probeInUse(entry.path)) {
    throw new Error("Native artifact became protected or changed before retirement.");
  }
  // Only fixed generated payload locations. Preserve all evidence files.
  for (const name of await readdir(entry.path)) {
    if (["runtime", "staging", "New Money 本地运行包"].includes(name)) {
      const path = join(entry.path, name);
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe native artifact payload.");
      await rm(path, { recursive: true });
    } else if (/^test-installation-[a-zA-Z0-9]+$/u.test(name)) {
      const testRoot = join(entry.path, name);
      if (await realpath(testRoot) !== testRoot) throw new Error("Unsafe test installation path.");
      const runtime = join(testRoot, "runtime");
      if (await optionalStat(runtime)) {
        const stat = await lstat(runtime);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe test runtime payload.");
        await rm(runtime, { recursive: true });
      }
    }
  }
  const { path, inode: _inode, device: _device, ...record } = entry;
  await writeFile(join(path, marker), JSON.stringify({ ...record, status: "RETIRED", retiredAt: new Date().toISOString() }, null, 2));
}

async function nativeArtifactInUse(path) {
  if (process.platform !== "darwin") throw new Error("Native artifact process protection requires macOS.");
  const { stdout } = await execute("/bin/ps", ["-ww", "-axo", "command="], { maxBuffer: 8 * 1024 * 1024, timeout: 10_000 });
  if (stdout.includes(`${path}${sep}`)) return true;
  let files;
  try { files = (await execute("/usr/sbin/lsof", ["-nP", "-Fn"], { maxBuffer: 32 * 1024 * 1024, timeout: 15_000 })).stdout; }
  catch (error) { if (error.code === 1 && !error.stdout && !error.stderr) return false; throw error; }
  return files.split("\n").some(line => line === `n${path}` || line.startsWith(`n${path}${sep}`));
}

async function pinArtifact(path) {
  const pin = join(path, ".keep");
  try { await writeFile(pin, "Explicitly retained by operator.\n", { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await lstat(pin);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe artifact pin.");
  }
}

async function optionalStat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
