import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MANIFEST_SCHEMA = "pi67.managed-npm-bundle.v1";
const MAX_TARBALL_FILES = 10_000;
const MAX_TARBALL_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_TREE_FILES = 50_000;
const MAX_TREE_BYTES = 768 * 1024 * 1024;

export function assertManagedNpmBundleLock(lock) {
  if (!Array.isArray(lock?.managedNpmBundles) || lock.managedNpmBundles.length === 0) {
    throw new Error("Managed npm bundle lock is missing.");
  }
  const ids = new Set();
  const packageNames = new Set();
  for (const entry of lock.managedNpmBundles) {
    if (
      !entry
      || typeof entry.id !== "string"
      || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(entry.id)
      || typeof entry.packageName !== "string"
      || entry.packageName !== entry.id
      || entry.source !== `npm:${entry.packageName}`
      || typeof entry.version !== "string"
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(entry.version)
      || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.packageIntegrity)
      || !Array.isArray(entry.extensionPaths)
      || entry.extensionPaths.length === 0
      || entry.extensionPaths.length > 16
      || entry.extensionPaths.some((path) => !isSafeRelativePath(path))
      || entry.defaultEnabled !== true
      || ids.has(entry.id)
      || packageNames.has(entry.packageName)
    ) throw new Error(`Managed npm bundle entry ${entry?.id ?? "unknown"} is invalid.`);
    ids.add(entry.id);
    packageNames.add(entry.packageName);
  }
}

export async function prepareManagedNpmBundles(options) {
  const {
    lock,
    outputRoot,
    projectRoot,
    cacheRoot,
    npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm"
  } = options;
  assertManagedNpmBundleLock(lock);
  const bundledRoot = join(outputRoot, "managed-packages", "bundled");
  await rm(bundledRoot, { recursive: true, force: true });
  await mkdir(join(bundledRoot, "packages"), { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  await copyFile(join(projectRoot, "package.json"), join(bundledRoot, "package.json"));
  await copyFile(join(projectRoot, "package-lock.json"), join(bundledRoot, "package-lock.json"));

  await execFileAsync(npmExecutable, [
    "ci",
    "--omit=dev",
    "--omit=peer",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-bin-links"
  ], {
    cwd: bundledRoot,
    maxBuffer: 2_000_000,
    timeout: 5 * 60_000
  });

  const packages = [];
  for (const entry of lock.managedNpmBundles) {
    const tarball = await resolvePackageTarball(entry, cacheRoot, npmExecutable);
    const packageRoot = join(bundledRoot, "packages", entry.id);
    await extractNpmTarball(tarball, packageRoot);
    const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (packageJson.name !== entry.packageName || packageJson.version !== entry.version) {
      throw new Error(`Managed npm package identity is invalid: ${entry.id}`);
    }
    for (const extensionPath of entry.extensionPaths) {
      const metadata = await stat(join(packageRoot, extensionPath));
      if (!metadata.isFile()) throw new Error(`Managed npm extension entry is invalid: ${entry.id}`);
    }
    packages.push({
      id: entry.id,
      packageName: entry.packageName,
      source: entry.source,
      version: entry.version,
      packageIntegrity: entry.packageIntegrity,
      packagePath: `packages/${entry.id}`,
      extensionPaths: entry.extensionPaths,
      defaultEnabled: entry.defaultEnabled
    });
  }

  const tree = await managedNpmBundleTreeSha256(bundledRoot);
  const manifest = {
    schema: MANIFEST_SCHEMA,
    catalogVersion: lock.catalogVersion,
    platform: process.platform,
    architecture: process.arch,
    lockfileSha256: sha256(await readFile(join(bundledRoot, "package-lock.json"))),
    treeSha256: tree.sha256,
    fileCount: tree.fileCount,
    totalBytes: tree.totalBytes,
    packages
  };
  await writeFile(join(bundledRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function assertPreparedManagedNpmBundles(options) {
  const { lock, outputRoot } = options;
  assertManagedNpmBundleLock(lock);
  const bundledRoot = join(outputRoot, "managed-packages", "bundled");
  const manifest = parseManagedNpmBundleManifest(
    JSON.parse(await readFile(join(bundledRoot, "manifest.json"), "utf8")),
    lock.catalogVersion
  );
  const tree = await managedNpmBundleTreeSha256(bundledRoot);
  if (
    tree.sha256 !== manifest.treeSha256
    || tree.fileCount !== manifest.fileCount
    || tree.totalBytes !== manifest.totalBytes
    || manifest.lockfileSha256 !== sha256(await readFile(join(bundledRoot, "package-lock.json")))
  ) throw new Error("Prepared managed npm bundle failed integrity validation.");
  if (JSON.stringify(manifest.packages) !== JSON.stringify(lock.managedNpmBundles.map((entry) => ({
    id: entry.id,
    packageName: entry.packageName,
    source: entry.source,
    version: entry.version,
    packageIntegrity: entry.packageIntegrity,
    packagePath: `packages/${entry.id}`,
    extensionPaths: entry.extensionPaths,
    defaultEnabled: entry.defaultEnabled
  })))) throw new Error("Prepared managed npm bundle does not match its source lock.");
  return manifest;
}

export async function managedNpmBundleTreeSha256(root) {
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;
  const visit = async (directory) => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => !(directory === root && entry.name === "manifest.json"))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).split(sep).join("/");
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Managed npm bundle contains an unsupported entry: ${relativePath}`);
      const bytes = await readFile(path);
      fileCount += 1;
      totalBytes += bytes.byteLength;
      if (fileCount > MAX_TREE_FILES || totalBytes > MAX_TREE_BYTES) {
        throw new Error("Managed npm bundle exceeds its integrity bounds.");
      }
      hash.update(`f\0${relativePath}\0`);
      hash.update(bytes);
      hash.update("\0");
    }
  };
  await visit(root);
  return { sha256: hash.digest("hex"), fileCount, totalBytes };
}

async function extractNpmTarball(tarballPath, destination) {
  const archive = gunzipSync(await readFile(tarballPath));
  let offset = 0;
  let fileCount = 0;
  let totalBytes = 0;
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const rawName = tarString(header.subarray(0, 100));
    const prefix = tarString(header.subarray(345, 500));
    const archivePath = prefix ? `${prefix}/${rawName}` : rawName;
    const size = tarOctal(header.subarray(124, 136));
    const mode = tarOctal(header.subarray(100, 108));
    const type = String.fromCharCode(header[156] ?? 0);
    const bodyEnd = offset + size;
    if (!Number.isSafeInteger(size) || size < 0 || bodyEnd > archive.length) {
      throw new Error("Managed npm tarball is truncated or malformed.");
    }
    const relativePath = archivePath === "package"
      ? ""
      : archivePath.startsWith("package/") ? archivePath.slice("package/".length) : undefined;
    if (relativePath === undefined || (relativePath !== "" && !isSafeRelativePath(relativePath))) {
      throw new Error("Managed npm tarball contains an unsafe path.");
    }
    if (type === "5") {
      if (relativePath) await mkdir(join(destination, relativePath), { recursive: true });
    } else if (type === "0" || type === "\0") {
      if (!relativePath) throw new Error("Managed npm tarball contains an invalid root file.");
      fileCount += 1;
      totalBytes += size;
      if (fileCount > MAX_TARBALL_FILES || totalBytes > MAX_TARBALL_UNPACKED_BYTES) {
        throw new Error("Managed npm tarball exceeds its extraction bounds.");
      }
      const output = containedPath(destination, relativePath);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, archive.subarray(offset, bodyEnd), { mode: mode & 0o111 ? 0o755 : 0o644 });
      if (process.platform !== "win32") await chmod(output, mode & 0o111 ? 0o755 : 0o644);
    } else {
      throw new Error(`Managed npm tarball contains unsupported entry type ${JSON.stringify(type)}.`);
    }
    offset += Math.ceil(size / 512) * 512;
  }
}

function parseManagedNpmBundleManifest(value, catalogVersion) {
  if (
    !value
    || value.schema !== MANIFEST_SCHEMA
    || value.catalogVersion !== catalogVersion
    || typeof value.platform !== "string"
    || typeof value.architecture !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.lockfileSha256 ?? "")
    || !/^[a-f0-9]{64}$/u.test(value.treeSha256 ?? "")
    || !Number.isSafeInteger(value.fileCount)
    || value.fileCount < 1
    || value.fileCount > MAX_TREE_FILES
    || !Number.isSafeInteger(value.totalBytes)
    || value.totalBytes < 1
    || value.totalBytes > MAX_TREE_BYTES
    || !Array.isArray(value.packages)
    || value.packages.length === 0
  ) throw new Error("Managed npm bundle manifest is invalid.");
  return value;
}

async function resolvePackageTarball(entry, cacheRoot, npmExecutable) {
  const fileName = `${entry.packageName}-${entry.version}.tgz`;
  const cachedPath = join(cacheRoot, fileName);
  if (await matchesIntegrity(cachedPath, entry.packageIntegrity)) return cachedPath;
  await rm(cachedPath, { force: true });
  const { stdout } = await execFileAsync(npmExecutable, [
    "pack",
    `${entry.packageName}@${entry.version}`,
    "--ignore-scripts",
    "--pack-destination",
    cacheRoot
  ], { maxBuffer: 2_000_000, timeout: 2 * 60_000 });
  const generated = String(stdout).trim().split(/\r?\n/u).at(-1);
  if (!generated || basename(generated) !== fileName) {
    throw new Error(`npm pack returned an unexpected artifact for ${entry.id}.`);
  }
  if (!await matchesIntegrity(cachedPath, entry.packageIntegrity)) {
    await rm(cachedPath, { force: true });
    throw new Error(`Managed npm package integrity mismatch: ${entry.id}`);
  }
  return cachedPath;
}

async function matchesIntegrity(path, integrity) {
  try {
    const bytes = await readFile(path);
    return `sha512-${createHash("sha512").update(bytes).digest("base64")}` === integrity;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function containedPath(root, relativePath) {
  const candidate = resolve(root, relativePath);
  const fromRoot = relative(resolve(root), candidate);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Managed npm path escaped its destination.");
  }
  return candidate;
}

function isSafeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1_024
    && !value.includes("\0")
    && !isAbsolute(value)
    && !value.split(/[\\/]/u).includes("..");
}

function tarString(bytes) {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
}

function tarOctal(bytes) {
  let value = tarString(bytes).trim();
  while (value.startsWith("\0")) value = value.slice(1);
  return value === "" ? 0 : Number.parseInt(value, 8);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
