import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMacosPreviewCandidateEvidence } from "../release/macos-preview-candidate.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const APPLICATION_BUNDLE_ID = "com.pi67.desktop";

export function resolveMacosPreviewTarget(platform, arch, root = repositoryRoot) {
  if (platform !== "darwin" || arch !== "arm64") {
    throw new Error(`macOS preview only supports darwin/arm64, received ${platform}/${arch}.`);
  }
  const applicationPath = join(root, "artifacts/release/mac-arm64/Pi-67 Desktop.app");
  return {
    applicationPath,
    asarPath: join(applicationPath, "Contents/Resources/app.asar"),
    executablePath: join(applicationPath, "Contents/MacOS/Pi-67 Desktop")
  };
}

export function processIdsForExecutable(processList, executablePath) {
  return processList.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/u);
    if (!match) return [];
    const command = match[2];
    return command === executablePath || command.startsWith(`${executablePath} `)
      ? [Number(match[1])]
      : [];
  });
}

export async function previewMacosUnsigned({
  arch = process.arch,
  platform = process.platform,
  root = repositoryRoot
} = {}) {
  const target = resolveMacosPreviewTarget(platform, arch, root);
  await quitRunningApplication(target.executablePath);
  await runPnpmScript("package:native:unsigned", root);
  await runPnpmScript("package:smoke", root);
  await writeMacosPreviewCandidateEvidence({
    releaseRoot: join(root, "artifacts/release"),
    sourceRoot: root
  });
  await Promise.all([access(target.applicationPath), access(target.asarPath), access(target.executablePath)]);
  await run("/usr/bin/open", ["-n", target.applicationPath], { cwd: root });
  const processIds = await waitForProcessState(target.executablePath, true, 10_000);
  const asar = await readFile(target.asarPath);
  const metadata = await stat(target.asarPath);
  const sha256 = createHash("sha256").update(asar).digest("hex");
  console.log(`Opened latest unsigned macOS preview: ${target.applicationPath}`);
  console.log(`app.asar modified=${metadata.mtime.toISOString()} size=${metadata.size} sha256=${sha256}`);
  console.log(`Pi-67 Desktop pid=${processIds.join(",")}`);
  return { ...target, modifiedAt: metadata.mtime, processIds, sha256, size: metadata.size };
}

async function quitRunningApplication(executablePath) {
  const running = await processIds(executablePath);
  if (running.length === 0) return;
  const exitCode = await run("/usr/bin/osascript", [
    "-e", `if application id "${APPLICATION_BUNDLE_ID}" is running then`,
    "-e", `tell application id "${APPLICATION_BUNDLE_ID}" to quit`,
    "-e", "end if"
  ]);
  if (exitCode !== 0) throw new Error(`Failed to request Pi-67 Desktop quit; osascript exited ${exitCode}.`);
  await waitForProcessState(executablePath, false, 10_000);
}

async function runPnpmScript(script, root) {
  const pnpmCli = await resolvePnpmCli(root);
  const exitCode = await run(process.execPath, [pnpmCli, "run", script], { cwd: root });
  if (exitCode !== 0) throw new Error(`${script} failed with exit code ${exitCode}.`);
}

async function resolvePnpmCli(root) {
  const candidates = [process.env.npm_execpath, resolve(root, "node_modules/pnpm/bin/pnpm.cjs")]
    .filter((candidate) => typeof candidate === "string" && candidate.length > 0);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the repository-local pnpm fallback.
    }
  }
  throw new Error("Unable to locate pnpm for the macOS preview workflow.");
}

async function waitForProcessState(executablePath, expectedRunning, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = await processIds(executablePath);
    if ((running.length > 0) === expectedRunning) return running;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  const expectation = expectedRunning ? "start" : "quit";
  throw new Error(`Timed out waiting for Pi-67 Desktop to ${expectation}: ${executablePath}`);
}

async function processIds(executablePath) {
  const result = await capture("/bin/ps", ["-ww", "-axo", "pid=,command="]);
  if (result.exitCode !== 0) throw new Error(`ps failed with exit code ${result.exitCode}.`);
  return processIdsForExecutable(result.stdout, executablePath);
}

function capture(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}.`));
      else resolvePromise({ exitCode: code ?? 1, stdout });
    });
  });
}

function run(command, arguments_, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}.`));
      else resolvePromise(code ?? 1);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await previewMacosUnsigned();
}
