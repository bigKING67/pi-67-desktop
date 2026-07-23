import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function expectedVersionTag(version) {
  if (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Invalid package version: ${String(version)}`);
  }
  return `v${version}`;
}

export async function verifyVersionTag(tag, repositoryRoot = root) {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const expected = expectedVersionTag(packageJson.version);
  if (tag !== expected) throw new Error(`Release tag ${tag} does not match package version ${expected}.`);

  const head = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const tagCommit = git(repositoryRoot, ["rev-list", "-n", "1", tag]);
  if (head !== tagCommit) throw new Error(`Release tag ${tag} does not resolve to the checked-out commit.`);
  console.log(`Verified release tag ${tag} at ${head}.`);
}

function git(cwd, arguments_) {
  return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tag = process.argv[2];
  if (!tag) throw new Error("Usage: node eng/release/verify-version-tag.mjs <tag>");
  await verifyVersionTag(tag);
}
