import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const IGNORED_DIRECTORIES = new Set(["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);

export async function managedPackageTreeSha256(root: string): Promise<string> {
  const absoluteRoot = resolve(root);
  const hash = createHash("sha256");
  const files = await collectFiles(absoluteRoot);
  for (const file of files.sort((left, right) => left.localeCompare(right))) {
    const relativePath = relative(absoluteRoot, file).split(sep).join("/");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(canonicalHashBytes(await readFile(file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function hashManagedSkillSet(skills: Array<{ name: string; sha256: string }>): string {
  const hash = createHash("sha256");
  for (const skill of [...skills].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(skill.name);
    hash.update("\0");
    hash.update(skill.sha256);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(root: string): Promise<string[]> {
  const rootMetadata = await lstat(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("受管 Overlay Package 必须是普通目录。");
  }
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || /\.py[cod]$/iu.test(entry.name)) continue;
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error("受管 Overlay 不能包含符号链接。");
      if (metadata.isDirectory()) await visit(path);
      else if (metadata.isFile()) output.push(path);
      else throw new Error("受管 Overlay 包含不支持的文件类型。");
    }
  };
  await visit(root);
  return output;
}

function canonicalHashBytes(content: Buffer): Buffer {
  if (content.includes(0)) return content;
  const text = content.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(content)) return content;
  return Buffer.from(text.replace(/\r\n/gu, "\n"), "utf8");
}
