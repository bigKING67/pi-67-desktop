import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export async function assertPreparedLocalModuleClosure(packageRoot, entryPath) {
  const visited = new Set();
  const visit = async (path) => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = await readFile(path, "utf8");
    const imports = [
      ...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'\n]*?\s+from\s+)?["'](\.[^"']+)["']/gu),
      ...source.matchAll(/\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/gu),
    ];
    for (const match of imports) {
      const resolved = await resolvePreparedLocalModule(dirname(path), match[1]);
      const localPath = resolved ? relative(packageRoot, resolved) : undefined;
      if (!localPath || isAbsolute(localPath) || localPath === ".." || localPath.startsWith(`..${sep}`)) {
        throw new Error(
          `Prepared package is missing local module ${match[1]} from ${relative(packageRoot, path)}.`,
        );
      }
      await visit(resolved);
    }
  };
  await visit(join(packageRoot, entryPath));
}

async function resolvePreparedLocalModule(importerDirectory, specifier) {
  const unresolved = resolve(importerDirectory, specifier);
  const candidates = specifier.endsWith(".js")
    ? [unresolved.replace(/\.js$/u, ".ts"), unresolved.replace(/\.js$/u, ".tsx"), unresolved]
    : [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, join(unresolved, "index.ts")];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next TypeScript/JavaScript resolution candidate.
    }
  }
  return undefined;
}
