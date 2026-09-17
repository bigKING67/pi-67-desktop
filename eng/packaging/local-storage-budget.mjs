import { lstat, mkdir, open, readdir, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const operations = ["nativePreparation", "nativeSigning", "desktopPackaging"];
const policyPath = "eng/packaging/local-storage-policy.json";

// Include ignored/hidden outputs. Do not follow symlinks; count hardlinks once.
// max(apparent, allocated) is conservative, not APFS unique physical storage.
export async function measureRepositoryStorage(sourceRoot) {
  const root = resolve(sourceRoot);
  if (await realpath(root) !== root) throw new Error("Storage root must be canonical, without symlinks.");
  const queue = [{ path: root, bucket: "(root)" }];
  const seen = new Set();
  const buckets = new Map();
  let entries = 0;
  for (let offset = 0; offset < queue.length;) {
    const batch = queue.slice(offset, offset + 8);
    offset += batch.length;
    await Promise.all(batch.map(async ({ path, bucket }) => {
      let stat;
      try { stat = await lstat(path); }
      catch (error) { if (error.code === "ENOENT") return; throw error; }
      if (stat.nlink > 1 && stat.ino > 0 && !stat.isDirectory()) {
        const identity = `${stat.dev}:${stat.ino}`;
        if (seen.has(identity)) return;
        seen.add(identity);
      }
      entries++;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + Math.max(stat.size, (stat.blocks ?? 0) * 512));
      if (!stat.isDirectory()) return;
      if (await realpath(path) !== path) throw new Error("Directory changed to a symlink during storage measurement.");
      let names;
      try { names = await readdir(path); }
      catch (error) { if (error.code === "ENOENT") return; throw error; }
      for (const name of names) queue.push({ path: join(path, name), bucket: path === root ? name : bucket });
    }));
  }
  const sizes = [...buckets].map(([path, bytes]) => ({ path, bytes })).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { root, metric: "max-apparent-allocated-hardlink-deduplicated", bytes: sizes.reduce((sum, entry) => sum + entry.bytes, 0), entries, buckets: sizes };
}

async function loadPolicy(sourceRoot) {
  const path = join(sourceRoot, policyPath);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384 || await realpath(path) !== path) {
    throw new Error("Unsafe local storage policy.");
  }
  const policy = JSON.parse(await readFile(path, "utf8"));
  const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
  if (policy.schema !== "pi67.local-storage-policy.v2" || !positiveInteger(policy.warningBytes)
    || !positiveInteger(policy.strongWarningBytes) || policy.warningBytes > policy.strongWarningBytes
    || operations.some(operation => !positiveInteger(policy.reserveBytes?.[operation]))) {
    throw new Error("Invalid local storage policy.");
  }
  return policy;
}

export function evaluateStorageBudget(measurement, policy, operation) {
  if (operation !== undefined && !operations.includes(operation)) throw new Error(`Unknown storage operation: ${operation}`);
  const reserveBytes = operation === undefined ? 0 : policy.reserveBytes[operation];
  const projectedBytes = measurement.bytes + reserveBytes;
  return { ...measurement, operation: operation ?? "check", reserveBytes, projectedBytes,
    warningBytes: policy.warningBytes, strongWarningBytes: policy.strongWarningBytes,
    status: projectedBytes >= policy.strongWarningBytes ? "HIGH_WARNING" : projectedBytes >= policy.warningBytes ? "WARNING" : "PASS" };
}

export async function checkRepositoryStorage({ sourceRoot = repositoryRoot, operation } = {}) {
  const root = resolve(sourceRoot);
  return evaluateStorageBudget(await measureRepositoryStorage(root), await loadPolicy(root), operation);
}

function summary(result) {
  const gb = bytes => `${(bytes / 1e9).toFixed(2)} GB`;
  return `Storage ${result.status}: current=${gb(result.bytes)}; reserve=${gb(result.reserveBytes)}; projected=${gb(result.projectedBytes)}; warning=${gb(result.warningBytes)}; strong-warning=${gb(result.strongWarningBytes)}.`
    + (result.status === "HIGH_WARNING" ? " Advisory only; build remains allowed. Inspect growth with pnpm run storage:check; no automatic deletion." : "");
}

export async function withRepositoryStorageBudget({ sourceRoot = repositoryRoot, operation, report = console.log }, build) {
  const root = resolve(sourceRoot);
  if (!operations.includes(operation)) throw new Error(`Unknown storage operation: ${operation}`);
  if (await realpath(root) !== root) throw new Error("Storage root must be canonical, without symlinks.");
  const policy = await loadPolicy(root);
  const artifacts = join(root, "artifacts");
  await mkdir(artifacts, { recursive: true });
  if (await realpath(artifacts) !== artifacts) throw new Error("Storage artifacts directory must not be a symlink.");
  const lockPath = join(artifacts, ".storage-budget.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("Storage budget is locked; finish the active build or inspect the stale lock and PID before retrying.");
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, operation, startedAt: new Date().toISOString() }));
    const before = evaluateStorageBudget(await measureRepositoryStorage(root), policy, operation);
    report(summary(before));
    let value; let buildFailure;
    try { value = await build(); } catch (error) { buildFailure = { error }; }
    try {
      const after = evaluateStorageBudget(await measureRepositoryStorage(root), policy);
      report(summary(after));
    } catch (error) {
      if (buildFailure) throw new AggregateError([buildFailure.error, error], `Build failed: ${String(buildFailure.error)}; ${error.message}`, { cause: buildFailure.error });
      throw error;
    }
    if (buildFailure) throw buildFailure.error;
    return value;
  } finally { await lock.close(); await rm(lockPath); }
}

// Signing also supports explicitly supplied output outside this checkout.
// That location is outside this repository's budget, not silently charged here.
export function withLocalArtifactStorageBudget(outputRoot, operation, build) {
  const path = relative(repositoryRoot, resolve(outputRoot));
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) return build();
  return withRepositoryStorageBudget({ operation }, build);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--") args.shift();
    let operation; let json = false;
    while (args.length) {
      const argument = args.shift();
      if (argument === "--json" && !json) json = true;
      else if (argument === "--for" && operation === undefined && operations.includes(args[0])) operation = args.shift();
      else throw new Error("Usage: storage:check [--json] [--for nativePreparation|nativeSigning|desktopPackaging]");
    }
    const result = await checkRepositoryStorage({ operation });
    console.log(json ? JSON.stringify(result, null, 2) : `${summary(result)}\n${result.buckets.slice(0, 6).map(entry => `  ${(entry.bytes / 1e9).toFixed(2)} GB  ${entry.path}`).join("\n")}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
