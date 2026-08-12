import { lstatSync } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { spawn } from "node:child_process";

const MAX_GIT_OUTPUT_BYTES = 8_192;
const GIT_TIMEOUT_MS = 60_000;
const SOURCE_CLEANUP_MAX_RETRIES = 10;
const SOURCE_CLEANUP_RETRY_DELAY_MS = 250;

export async function resolveExactCapabilitySource({
  source,
  repositoryRoot,
  sourceCacheRoot,
  git
}) {
  const local = resolve(repositoryRoot, source.localSibling);
  if (await isExactCleanRepository(local, source.commit, git)) return local;
  const destination = join(sourceCacheRoot, source.id);
  await removeSourceTree(destination);
  await mkdir(dirname(destination), { recursive: true });
  let lastError;
  const transports = [
    ...(await repositoryContainsCommit(local, source.commit, git) ? [local] : []),
    ...capabilityGitTransportCandidates(source.repository)
  ];
  for (const url of transports) {
    try {
      await run(git, ["init", destination]);
      await run(git, ["-C", destination, "remote", "add", "origin", url]);
      await run(git, ["-C", destination, "fetch", "--depth", "1", "--no-tags", "origin", source.commit]);
      await run(git, ["-C", destination, "checkout", "--detach", source.commit]);
      await run(git, ["-C", destination, "remote", "set-url", "origin", source.repository]);
      if (await capture(git, ["-C", destination, "rev-parse", "HEAD"]) !== source.commit) {
        throw new Error("checked out commit did not match the lock");
      }
      return destination;
    } catch (error) {
      lastError = error;
      await removeSourceTree(destination);
    }
  }
  throw new Error(`Unable to obtain locked capability source ${source.id}: ${errorMessage(lastError)}`);
}

export async function resolveBundledGitToolchain(toolchainManifestPath) {
  const manifest = JSON.parse(await readFile(toolchainManifestPath, "utf8"));
  const root = dirname(toolchainManifestPath);
  const executable = resolve(root, manifest.paths?.git ?? "");
  const execPath = resolve(root, manifest.paths?.gitExecPath ?? "");
  const remoteHttps = resolve(execPath, process.platform === "win32" ? "git-remote-https.exe" : "git-remote-https");
  if (![executable, execPath, remoteHttps].every((path) => isContained(path, root))) {
    throw new Error("Bundled Git escaped the Desktop toolchain root.");
  }
  await Promise.all([stat(executable), stat(execPath), stat(remoteHttps)]);
  return { executable, execPath };
}

export async function resolveBundledNpmToolchain(toolchainManifestPath) {
  const manifest = JSON.parse(await readFile(toolchainManifestPath, "utf8"));
  const root = dirname(toolchainManifestPath);
  const executable = resolve(root, manifest.paths?.node ?? "");
  const npmCli = resolve(root, manifest.paths?.npmCli ?? "");
  if (![executable, npmCli].every((path) => isContained(path, root))) {
    throw new Error("Bundled Node/npm escaped the Desktop toolchain root.");
  }
  await Promise.all([stat(executable), stat(npmCli)]);
  return { executable, argumentsPrefix: [npmCli] };
}

async function repositoryContainsCommit(path, commit, git) {
  try {
    if (!lstatSync(path).isDirectory()) return false;
    return await capture(git, ["-C", path, "rev-parse", "--verify", `${commit}^{commit}`]) === commit;
  } catch {
    return false;
  }
}

async function isExactCleanRepository(path, commit, git) {
  try {
    if (!lstatSync(path).isDirectory()) return false;
    const head = await capture(git, ["-C", path, "rev-parse", "HEAD"]);
    if (head !== commit) return false;
    return (await capture(git, ["-C", path, "status", "--porcelain=v1", "--untracked-files=all"])) === "";
  } catch {
    return false;
  }
}

export function capabilityGitTransportCandidates(canonical) {
  const parsed = new URL(canonical);
  const path = parsed.pathname.replace(/^\/+|\/+$/gu, "");
  return [
    canonical,
    `https://gitclone.com/github.com/${path}`,
    `https://ghproxy.net/${canonical}`
  ];
}

function capture(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command.executable, arguments_, {
      stdio: ["ignore", "pipe", "pipe"],
      env: gitEnvironment(command.execPath),
      detached: process.platform !== "win32",
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let termination = Promise.resolve();
    const timeout = setTimeout(() => {
      timedOut = true;
      termination = terminateProcessTree(child);
    }, GIT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      void termination.then(() => {
        if (code === 0) resolvePromise(stdout.trim());
        else reject(new Error(`${basename(command.executable)} ${timedOut ? "timed out" : `exited with ${signal ?? code}`}: ${(stderr || stdout).trim()}`));
      });
    });
  });
}

export function runCapabilityGitCommand(command, arguments_, { timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command.executable, arguments_, {
      stdio: ["ignore", "pipe", "pipe"],
      env: gitEnvironment(command.execPath),
      detached: process.platform !== "win32",
      windowsHide: true
    });
    let output = "";
    let timedOut = false;
    let termination = Promise.resolve();
    const timeout = setTimeout(() => {
      timedOut = true;
      termination = terminateProcessTree(child);
    }, timeoutMs);
    const captureOutput = (chunk) => {
      if (output.length < MAX_GIT_OUTPUT_BYTES) {
        output += String(chunk).slice(0, MAX_GIT_OUTPUT_BYTES - output.length);
      }
    };
    child.stdout.on("data", captureOutput);
    child.stderr.on("data", captureOutput);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      void termination.then(() => {
        if (code === 0) resolvePromise();
        else reject(new Error(`${basename(command.executable)} ${timedOut ? "timed out" : `exited with ${signal ?? code}`}: ${output.trim()}`));
      });
    });
  });
}

const run = runCapabilityGitCommand;

async function terminateProcessTree(child) {
  if (child.pid === undefined) return;
  // Git transport helpers outlive their parent unless the entire process tree is terminated.
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    return;
  }
  await new Promise((resolvePromise) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.once("error", () => {
      child.kill();
      resolvePromise();
    });
    killer.once("exit", () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      resolvePromise();
    });
  });
}

function removeSourceTree(path) {
  return rm(path, {
    recursive: true,
    force: true,
    maxRetries: SOURCE_CLEANUP_MAX_RETRIES,
    retryDelay: SOURCE_CLEANUP_RETRY_DELAY_MS
  });
}

function gitEnvironment(execPath) {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_EXEC_PATH: execPath
  };
}

function isContained(candidate, root) {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
