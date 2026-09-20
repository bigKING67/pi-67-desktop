import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

// Hash actual interpreter/code bytes, not timestamps or a claimed version alone.
// Keep broad production inputs so verifier changes invalidate reuse, while
// known documentation, unit-test and generated-cache files do not force a copy.
export async function nativePreparationKey({ pythonRoot, repositoryRoot, purpose, keepTestInstallation, includePythonPath }) {
  const digest = createHash("sha256");
  digest.update(JSON.stringify(["native-preparation-v2", process.platform, process.arch, process.version, purpose, keepTestInstallation]));
  for (const [label, root, include] of [
    ["python", pythonRoot, includePythonPath],
    ["capabilities", join(repositoryRoot, "eng/capabilities"), includeRepositoryInput],
    ["desktop", join(repositoryRoot, "apps/desktop/src"), includeRepositoryInput],
    ["protocol", join(repositoryRoot, "packages/protocol/src"), includeRepositoryInput]
  ]) {
    digest.update(label);
    const canonical = await realpath(root);
    async function walk(path) {
      const name = relative(root, path);
      if (!include(name)) return;
      const before = await lstat(path);
      if (before.isSymbolicLink()) {
        const target = await readlink(path);
        const resolved = await realpath(path);
        if (isAbsolute(target) || !resolved.startsWith(`${canonical}${sep}`)) throw new Error("Input symlink escapes its tree.");
        digest.update(JSON.stringify([name, "link", target]));
      } else if (before.isDirectory()) {
        for (const child of (await readdir(path)).sort()) await walk(join(path, child));
      } else if (before.isFile()) {
        digest.update(JSON.stringify([name, before.mode & 0o777]));
        digest.update(createHash("sha256").update(await readFile(path)).digest());
      } else throw new Error("Unsupported native preparation input.");
      const after = await lstat(path);
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        throw new Error("Native preparation input changed while hashing.");
      }
    }
    await walk(root);
  }
  return digest.digest("hex");
}

function includeRepositoryInput(name) {
  const parts = name.split(sep);
  return name !== "README.md" && !parts.includes(".DS_Store") && !parts.includes("__pycache__")
    && !/\.test\.(?:[cm]?[jt]s|[jt]sx)$/u.test(parts.at(-1));
}
