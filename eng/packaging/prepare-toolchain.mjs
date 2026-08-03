import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const lockPath = resolve(repositoryRoot, "eng/packaging/toolchain.lock.json");
const cacheRoot = resolve(repositoryRoot, "artifacts/toolchain/cache");
const stagingRoot = resolve(repositoryRoot, "artifacts/toolchain/current");
const WINDOWS_GIT_HTTP_HELPERS = ["git-remote-http.exe", "git-remote-https.exe"];

export async function prepareDesktopToolchain(platform = process.platform, architecture = process.arch) {
  const target = `${platform}-${architecture}`;
  if (target !== "darwin-arm64" && target !== "win32-x64") {
    throw new Error(`Desktop toolchain does not support ${target}.`);
  }
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const nodeArtifact = requiredArtifact(lock.node.artifacts, target, "Node");
  const gitArtifact = requiredArtifact(lock.git.artifacts, target, "Git");
  const expectedGitVersion = requiredReportedVersion(gitArtifact, "Git");

  await mkdir(cacheRoot, { recursive: true });
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  const [nodeArchive, npmArchive, gitArchive] = await Promise.all([
    obtainVerifiedArchive(nodeArtifact),
    obtainVerifiedArchive(lock.npm),
    obtainVerifiedArchive(gitArtifact)
  ]);

  const extractionRoot = resolve(repositoryRoot, "artifacts/toolchain/extract");
  await rm(extractionRoot, { recursive: true, force: true });
  await mkdir(extractionRoot, { recursive: true });
  try {
    await extractNode(nodeArchive, join(extractionRoot, "node"), join(stagingRoot, "node"));
    await extractSingleDirectory(npmArchive, join(extractionRoot, "npm"), join(stagingRoot, "npm"));
    await extractArchive(gitArchive, join(stagingRoot, "git"));
    if (platform === "win32") await materializeWindowsGitHttpHelpers(join(stagingRoot, "git"));
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }

  const paths = toolPaths(stagingRoot, platform);
  await Promise.all([
    access(paths.node),
    access(paths.npmCli),
    access(paths.git),
    access(paths.gitExecPath),
    access(paths.gitRemoteHttps)
  ]);
  if (platform !== "win32") {
    await Promise.all([chmod(paths.node, 0o755), chmod(paths.git, 0o755)]);
  }

  const versions = {
    node: (await capture(paths.node, ["--version"])).replace(/^v/u, ""),
    npm: await capture(paths.node, [paths.npmCli, "--version"]),
    git: (await capture(paths.git, ["--version"])).replace(/^git version\s+/u, "")
  };
  assertVersion("Node", versions.node, lock.node.version);
  assertVersion("npm", versions.npm, lock.npm.version);
  assertVersion("Git", versions.git, expectedGitVersion);

  const manifest = {
    schema: "pi67.desktop-toolchain.v1",
    platform,
    architecture,
    versions: {
      ...versions,
      gitBundle: lock.git.bundleVersion
    },
    paths: {
      node: relativeToolPath(stagingRoot, paths.node),
      npmCli: relativeToolPath(stagingRoot, paths.npmCli),
      git: relativeToolPath(stagingRoot, paths.git),
      gitExecPath: relativeToolPath(stagingRoot, paths.gitExecPath)
    },
    archives: {
      node: { fileName: nodeArtifact.fileName, sha256: nodeArtifact.sha256 },
      npm: { fileName: lock.npm.fileName, sha256: lock.npm.sha256 },
      git: { fileName: gitArtifact.fileName, sha256: gitArtifact.sha256 }
    }
  };
  await writeFile(join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Prepared Pi-67 Desktop toolchain ${target}: Node ${versions.node}, npm ${versions.npm}, Git ${versions.git}.`);
  return manifest;
}

export async function materializeWindowsGitHttpHelpers(gitRoot) {
  const binaryRoot = join(gitRoot, "mingw64", "bin");
  const execRoot = join(gitRoot, "mingw64", "libexec", "git-core");
  await mkdir(execRoot, { recursive: true });
  await Promise.all(WINDOWS_GIT_HTTP_HELPERS.map(async (helper) => {
    const destination = join(execRoot, helper);
    try {
      await access(destination);
      return;
    } catch {
      // Dugite keeps these verified transport helpers in mingw64/bin.
    }
    await copyFile(join(binaryRoot, helper), destination);
  }));
}

function requiredArtifact(artifacts, target, label) {
  const artifact = artifacts?.[target];
  if (!artifact) throw new Error(`${label} has no locked artifact for ${target}.`);
  return artifact;
}

function requiredReportedVersion(artifact, label) {
  if (typeof artifact.reportedVersion !== "string" || artifact.reportedVersion.length === 0) {
    throw new Error(`${label} artifact has no locked reported version.`);
  }
  return artifact.reportedVersion;
}

async function obtainVerifiedArchive(artifact) {
  const destination = join(cacheRoot, artifact.fileName);
  try {
    if (await sha256(destination) === artifact.sha256) return destination;
  } catch {
    // Download below when the cache entry is absent or unreadable.
  }
  await rm(destination, { force: true });
  let lastError;
  for (const url of artifact.urls) {
    const partial = `${destination}.partial`;
    await rm(partial, { force: true });
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(300_000),
        headers: { "User-Agent": "pi-67-desktop-toolchain" }
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const output = (await import("node:fs")).createWriteStream(partial, { mode: 0o600 });
      await pipeline(Readable.fromWeb(response.body), output);
      const actual = await sha256(partial);
      if (actual !== artifact.sha256) {
        throw new Error(`SHA-256 mismatch: expected ${artifact.sha256}, received ${actual}`);
      }
      await rename(partial, destination);
      return destination;
    } catch (error) {
      lastError = new Error(`Unable to download ${basename(destination)} from ${url}: ${error instanceof Error ? error.message : String(error)}`);
      await rm(partial, { force: true });
    }
  }
  throw lastError ?? new Error(`No download source was configured for ${artifact.fileName}.`);
}

async function extractNode(archive, extractionDirectory, destination) {
  await extractArchive(archive, extractionDirectory);
  const entries = (await readdir(extractionDirectory, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error("Node archive must contain exactly one root directory.");
  await rename(join(extractionDirectory, entries[0].name), destination);
}

async function extractSingleDirectory(archive, extractionDirectory, destination) {
  await extractArchive(archive, extractionDirectory);
  const candidate = join(extractionDirectory, "package");
  const metadata = await stat(candidate);
  if (!metadata.isDirectory()) throw new Error("npm archive did not contain the expected package directory.");
  await rename(candidate, destination);
}

async function extractArchive(archive, destination) {
  await mkdir(destination, { recursive: true });
  await run("tar", ["-xf", archive, "-C", destination]);
}

function toolPaths(root, platform) {
  return platform === "win32"
    ? {
        node: join(root, "node", "node.exe"),
        npmCli: join(root, "npm", "bin", "npm-cli.js"),
        git: join(root, "git", "cmd", "git.exe"),
        gitExecPath: join(root, "git", "mingw64", "libexec", "git-core"),
        gitRemoteHttps: join(root, "git", "mingw64", "libexec", "git-core", "git-remote-https.exe")
      }
    : {
        node: join(root, "node", "bin", "node"),
        npmCli: join(root, "npm", "bin", "npm-cli.js"),
        git: join(root, "git", "bin", "git"),
        gitExecPath: join(root, "git", "libexec", "git-core"),
        gitRemoteHttps: join(root, "git", "libexec", "git-core", "git-remote-https")
      };
}

function relativeToolPath(root, path) {
  return path.slice(root.length + 1).split("\\").join("/");
}

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

function capture(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`${command} exited with ${signal ?? code}: ${(stderr || stdout).trim()}`));
    });
  });
}

function run(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${signal ?? code}.`));
    });
  });
}

function assertVersion(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label} version mismatch: expected ${expected}, received ${actual}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareDesktopToolchain();
}
