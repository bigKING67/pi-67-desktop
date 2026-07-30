import { execFile as execFileCallback } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPiRuntimeContract } from "../release/pi-runtime-contract.mjs";
import { collectExternalReferenceIssues } from "./external-reference-contract.mjs";

const execFile = promisify(execFileCallback);
const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const maximumJsonBytes = 1_048_576;
const paths = {
  catalog: "references.catalog.json",
  lock: "references.lock.json",
  provenance: "licenses/provenance.json"
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkExternalReferenceGovernance(defaultRoot);
    console.log(
      `External reference governance passed: ${result.catalog.repositories.length} repositories, `
      + `${Object.keys(result.reviewLock.reviews).length} locked review(s), `
      + `${result.provenance.entries.length} code provenance record(s).`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function checkExternalReferenceGovernance(root = defaultRoot) {
  const [catalog, reviewLock, provenance, repositoryFiles] = await Promise.all([
    readBoundedJson(root, paths.catalog),
    readBoundedJson(root, paths.lock),
    readBoundedJson(root, paths.provenance),
    listRepositoryFiles(root)
  ]);
  const repositoryContents = await readReviewNotes(root, reviewLock, repositoryFiles);
  const issues = collectExternalReferenceIssues({
    catalog,
    reviewLock,
    provenance,
    repositoryContents,
    repositoryFiles
  });
  try {
    await readPiRuntimeContract(root);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (issues.length > 0) {
    throw new Error(
      `External reference governance failed with ${issues.length} issue(s):\n`
      + issues.map((issue) => `- ${issue}`).join("\n")
    );
  }
  return { catalog, provenance, reviewLock };
}

async function readBoundedJson(root, path) {
  const absolutePath = join(root, path);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumJsonBytes) {
    throw new Error(`${path} must be a non-empty JSON file no larger than ${maximumJsonBytes} bytes`);
  }
  const source = await readFile(absolutePath, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${path} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function listRepositoryFiles(root) {
  const { stdout } = await execFile(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1_048_576, timeout: 15_000 }
  );
  return new Set(stdout.split("\0").filter(Boolean));
}

async function readReviewNotes(root, reviewLock, repositoryFiles) {
  const contents = new Map();
  if (reviewLock === null || typeof reviewLock !== "object" || Array.isArray(reviewLock)) return contents;
  if (reviewLock.reviews === null || typeof reviewLock.reviews !== "object" || Array.isArray(reviewLock.reviews)) return contents;
  const notesPaths = new Set(Object.values(reviewLock.reviews)
    .map((review) => review?.notesPath)
    .filter((path) => typeof path === "string" && repositoryFiles.has(path)));
  await Promise.all([...notesPaths].map(async (path) => {
    const absolutePath = join(root, path);
    if (toRepoPath(root, absolutePath) !== path) return;
    const metadata = await stat(absolutePath);
    if (!metadata.isFile() || metadata.size > maximumJsonBytes) return;
    contents.set(path, await readFile(absolutePath, "utf8"));
  }));
  return contents;
}

function toRepoPath(root, path) {
  return relative(root, path).split(sep).join("/");
}
