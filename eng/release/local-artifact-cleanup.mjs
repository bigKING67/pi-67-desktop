import { execFile as execFileCallback } from "node:child_process";
import { lstat, readdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const PRODUCT_ARTIFACT_NAME = /^Pi-67-Desktop-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-(?:win-x64(?:-unsigned-preview)?\.exe|mac-arm64(?:-unsigned-preview)?\.(?:dmg|zip))(?:\.blockmap)?$/u;
const WINDOWS_CANDIDATE_DIRECTORY = /^windows-candidate-\d+-\d+$/u;
const LEGACY_WINDOWS_CANDIDATE_DIRECTORY = /^windows-alpha\d+-\d+$/u;
const VALIDATION_WINDOWS_CANDIDATE_DIRECTORY = /^alpha\d+-windows-candidate$/u;
const RELEASE_EPHEMERAL_FILES = new Set([
  "builder-debug.yml",
  "builder-effective-config.yaml",
  "latest-mac.yml",
  "latest.yml"
]);
const RELEASE_EPHEMERAL_DIRECTORIES = new Set([".icon-icns", "mac-arm64", "win-unpacked"]);

export async function planLocalArtifactCleanup({ root = repositoryRoot } = {}) {
  const canonicalRoot = resolve(root);
  const artifactsRoot = join(canonicalRoot, "artifacts");
  const scanRoots = await resolveScanRoots(artifactsRoot);
  const targets = [];

  for (const scanRoot of scanRoots) {
    await scanDirectory(scanRoot, scanRoot.path, targets, canonicalRoot);
  }

  targets.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    bytes: targets.reduce((total, target) => total + target.bytes, 0),
    preservedEvidence: [
      "JSON identity, manifest, receipt, and smoke evidence",
      "SHA256SUMS.txt and diagnostic text",
      "candidate validation screenshots and shortcut observations",
      "R2 publication receipts"
    ],
    root: canonicalRoot,
    targets
  };
}

export async function applyLocalArtifactCleanup({
  confirmed = false,
  probeRunningProcesses = probeRepositoryPreviewProcesses,
  root = repositoryRoot
} = {}) {
  if (!confirmed) {
    throw new Error("Local artifact cleanup requires --confirm-local-artifact-cleanup.");
  }

  const plan = await planLocalArtifactCleanup({ root });
  if (plan.targets.length === 0) return { after: plan, before: plan, removed: [] };

  const runningProcesses = await probeRunningProcesses({ root: plan.root });
  if (runningProcesses.length > 0) {
    throw new Error(
      `Local artifact cleanup refused because a Pi-67 repository preview is running: ${runningProcesses.join(", ")}`
    );
  }

  const removed = [];
  for (const target of plan.targets) {
    await assertTargetUnchanged(target);
    await rm(target.absolutePath, { force: false, recursive: target.kind === "directory" });
    removed.push(target.relativePath);
  }

  const after = await planLocalArtifactCleanup({ root: plan.root });
  if (after.targets.length > 0) {
    throw new Error(`Local artifact cleanup left ${after.targets.length} recognized target(s).`);
  }
  return { after, before: plan, removed };
}

export async function probeRepositoryPreviewProcesses({
  platform = process.platform,
  root = repositoryRoot
} = {}) {
  if (platform === "darwin") return probeMacosPreviewProcesses(root);
  if (platform === "win32") return probeWindowsPreviewProcesses();
  throw new Error(`Local artifact cleanup apply is unsupported on ${platform}; refusing without a process probe.`);
}

export function parseLocalArtifactCleanupArguments(arguments_) {
  const normalizedArguments = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (
    normalizedArguments.length === 0
    || (normalizedArguments.length === 1 && normalizedArguments[0] === "plan")
  ) {
    return { confirmed: false, mode: "plan" };
  }
  if (
    normalizedArguments.length === 2
    && normalizedArguments[0] === "apply"
    && normalizedArguments[1] === "--confirm-local-artifact-cleanup"
  ) {
    return { confirmed: true, mode: "apply" };
  }
  throw new Error(
    "Usage: node eng/release/local-artifact-cleanup.mjs [plan | apply --confirm-local-artifact-cleanup]"
  );
}

async function resolveScanRoots(artifactsRoot) {
  const roots = [];
  await addFixedScanRoot(roots, join(artifactsRoot, "release"), "release");
  await addFixedScanRoot(roots, join(artifactsRoot, "verified-unsigned-preview"), "bundle");
  await addFixedScanRoot(roots, join(artifactsRoot, "r2-update-bundle"), "bundle");
  await addMatchingChildScanRoots(
    roots,
    join(artifactsRoot, "candidates"),
    LEGACY_WINDOWS_CANDIDATE_DIRECTORY,
    "candidate"
  );
  await addMatchingChildScanRoots(
    roots,
    artifactsRoot,
    WINDOWS_CANDIDATE_DIRECTORY,
    "candidate"
  );
  await addMatchingChildScanRoots(
    roots,
    join(artifactsRoot, "validation"),
    VALIDATION_WINDOWS_CANDIDATE_DIRECTORY,
    "candidate"
  );
  return roots;
}

async function addFixedScanRoot(roots, path, policy) {
  const metadata = await optionalMetadata(path);
  if (!metadata) return;
  assertRealDirectory(path, metadata);
  roots.push({ path, policy });
}

async function addMatchingChildScanRoots(roots, parent, pattern, policy) {
  const parentMetadata = await optionalMetadata(parent);
  if (!parentMetadata) return;
  assertRealDirectory(parent, parentMetadata);
  const entries = await readdir(parent, { withFileTypes: true });
  for (const entry of entries) {
    if (!pattern.test(entry.name)) continue;
    const path = join(parent, entry.name);
    const metadata = await lstat(path);
    assertRealDirectory(path, metadata);
    roots.push({ path, policy });
  }
}

async function scanDirectory(scanRoot, directory, targets, root) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativeToScanRoot = relative(scanRoot.path, absolutePath);
    const metadata = await lstat(absolutePath);

    if (shouldRemoveDirectory(scanRoot.policy, relativeToScanRoot, entry.name)) {
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`Recognized cleanup directory is not a real directory: ${relative(root, absolutePath)}`);
      }
      targets.push(await describeTarget(root, absolutePath, "directory", metadata));
      continue;
    }

    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      await scanDirectory(scanRoot, absolutePath, targets, root);
      continue;
    }

    if (!shouldRemoveFile(scanRoot.policy, relativeToScanRoot, entry.name)) continue;
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Recognized cleanup file is not a regular file: ${relative(root, absolutePath)}`);
    }
    targets.push(await describeTarget(root, absolutePath, "file", metadata));
  }
}

function shouldRemoveDirectory(policy, relativePath, name) {
  if (policy === "release") return !relativePath.includes(sep) && RELEASE_EPHEMERAL_DIRECTORIES.has(name);
  if (policy !== "candidate" || name !== "win-unpacked") return false;
  return basename(resolve(relativePath, "..")) === "release";
}

function shouldRemoveFile(policy, relativePath, name) {
  if (policy === "release" && !relativePath.includes(sep) && RELEASE_EPHEMERAL_FILES.has(name)) return true;
  if (policy === "bundle" && relativePath.includes(sep)) return false;
  return PRODUCT_ARTIFACT_NAME.test(name);
}

async function describeTarget(root, absolutePath, kind, metadata) {
  assertWithinRoot(root, absolutePath);
  return {
    absolutePath,
    bytes: kind === "directory" ? await directoryBytes(absolutePath) : metadata.size,
    device: metadata.dev,
    inode: metadata.ino,
    kind,
    relativePath: relative(root, absolutePath)
  };
}

async function directoryBytes(directory) {
  let bytes = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) bytes += await directoryBytes(path);
    else bytes += metadata.size;
  }
  return bytes;
}

async function assertTargetUnchanged(target) {
  const metadata = await lstat(target.absolutePath);
  const currentKind = metadata.isDirectory() && !metadata.isSymbolicLink() ? "directory" : "file";
  if (currentKind !== target.kind || metadata.dev !== target.device || metadata.ino !== target.inode) {
    throw new Error(`Cleanup target changed after planning: ${target.relativePath}`);
  }
}

function assertWithinRoot(root, path) {
  const relativePath = relative(root, path);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Cleanup target escapes the repository root: ${path}`);
  }
}

function assertRealDirectory(path, metadata) {
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Cleanup scan root is not a real directory: ${path}`);
  }
}

async function optionalMetadata(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function probeMacosPreviewProcesses(root) {
  const executable = join(
    resolve(root),
    "artifacts/release/mac-arm64/Pi-67 Desktop.app/Contents/MacOS/Pi-67 Desktop"
  );
  const { stdout } = await execFile("/bin/ps", ["-ww", "-axo", "pid=,command="], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/u);
    if (!match) return [];
    const command = match[2];
    return command === executable || command.startsWith(`${executable} `) ? [`pid=${match[1]}`] : [];
  });
}

async function probeWindowsPreviewProcesses() {
  const { stdout } = await execFile(
    "tasklist.exe",
    ["/FI", "IMAGENAME eq Pi-67 Desktop.exe", "/FO", "CSV", "/NH"],
    { maxBuffer: 1024 * 1024 }
  );
  const rows = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return rows.filter((line) => !line.startsWith("INFO:")).map((line) => line.slice(0, 200));
}

function formatBytes(bytes) {
  return `${bytes} bytes (${(bytes / 1024 / 1024 / 1024).toFixed(3)} GiB)`;
}

function printPlan(plan) {
  console.log(`Local artifact cleanup plan: ${plan.targets.length} target(s), ${formatBytes(plan.bytes)}.`);
  for (const target of plan.targets) {
    console.log(`DELETE ${target.kind} ${target.relativePath} (${target.bytes} bytes)`);
  }
  console.log(`PRESERVE ${plan.preservedEvidence.join("; ")}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseLocalArtifactCleanupArguments(process.argv.slice(2));
    if (options.mode === "plan") {
      printPlan(await planLocalArtifactCleanup());
    } else {
      const result = await applyLocalArtifactCleanup({ confirmed: options.confirmed });
      printPlan(result.before);
      console.log(`Removed ${result.removed.length} local artifact target(s); recognized residue count=0.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
