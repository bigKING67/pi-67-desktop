import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export async function copyAllowedCapabilityEntries(sourceRoot, destinationRoot, paths) {
  for (const path of paths) {
    assertRelativePath(path, "capability allowlist path");
    const source = join(sourceRoot, path);
    try {
      await copyEntry(source, join(destinationRoot, path), sourceRoot);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue;
      throw error;
    }
  }
}

export async function copyCapabilityEntry(source, destination, sourceRoot) {
  assertRelativePath(relative(sourceRoot, source), "capability source path");
  await copyEntry(source, destination, sourceRoot);
}

export async function writeCapabilityPackageManifest(destination, manifest) {
  await writeFile(join(destination, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function assertRelativePath(path, label) {
  if (
    typeof path !== "string"
    || path.length === 0
    || path.includes("\0")
    || isAbsolute(path)
    || path.split(/[\\/]/u).includes("..")
  ) throw new Error(`${label} must be a contained relative path.`);
}

async function copyEntry(source, destination, sourceRoot) {
  if (!isContained(source, sourceRoot)) throw new Error("Capability copy escaped its locked source root.");
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new Error(`Capability sources cannot contain symlinks: ${source}`);
  if (metadata.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = (await readdir(source, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".DS_Store")
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await copyEntry(join(source, entry.name), join(destination, entry.name), sourceRoot);
    }
    return;
  }
  if (!metadata.isFile()) throw new Error(`Unsupported capability source entry: ${source}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source), { mode: metadata.mode & 0o111 ? 0o755 : 0o644 });
}

function isContained(candidate, root) {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function isNodeError(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}
