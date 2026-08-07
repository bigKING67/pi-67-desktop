import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { HostCommandError } from "./protocol-error.js";

interface PackageWorkerProcessTreeTermination {
  force: boolean;
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
  deadlineMs: number;
}

export type PackageWorkerProcessTreeTerminator = (
  child: ChildProcess,
  termination: PackageWorkerProcessTreeTermination
) => Promise<boolean | void>;

export type PackageWorkerProcessTreeInspector = (
  child: ChildProcess,
  platform: NodeJS.Platform
) => Promise<boolean>;

export async function terminateAndWaitForPackageWorkerProcessTree(
  child: ChildProcess,
  exited: Promise<void>,
  deadlineMs: number,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  terminateProcessTree: PackageWorkerProcessTreeTerminator,
  inspectProcessTree: PackageWorkerProcessTreeInspector
): Promise<void> {
  if (!isChildRunning(child)) {
    let forcedConfirmed = false;
    try {
      forcedConfirmed = await terminateProcessTree(child, {
        force: true,
        platform,
        environment,
        deadlineMs
      }) === true;
    } catch {
      // The bounded tree inspection below remains authoritative.
    }
    if (await waitForPackageWorkerTreeExit(
      child,
      exited,
      deadlineMs,
      forcedConfirmed,
      platform,
      inspectProcessTree
    )) return;
    throw packageWorkerTreeCleanupFailure();
  }

  const gracefulMs = Math.max(1, Math.floor(deadlineMs / 2));
  const forcedMs = Math.max(1, deadlineMs - gracefulMs);
  let gracefulConfirmed = false;
  try {
    gracefulConfirmed = await terminateProcessTree(child, {
      force: false,
      platform,
      environment,
      deadlineMs: gracefulMs
    }) === true;
  } catch {
    // The forced phase below is authoritative.
  }
  if (await waitForPackageWorkerTreeExit(
    child,
    exited,
    gracefulMs,
    gracefulConfirmed,
    platform,
    inspectProcessTree
  )) return;

  let forcedConfirmed = false;
  try {
    forcedConfirmed = await terminateProcessTree(child, {
      force: true,
      platform,
      environment,
      deadlineMs: forcedMs
    }) === true;
  } catch {
    // The bounded exit wait below decides whether shutdown succeeded.
  }
  if (await waitForPackageWorkerTreeExit(
    child,
    exited,
    forcedMs,
    forcedConfirmed,
    platform,
    inspectProcessTree
  )) return;
  throw packageWorkerTreeCleanupFailure();
}

export async function terminatePackageWorkerProcessTree(
  child: ChildProcess,
  termination: PackageWorkerProcessTreeTermination
): Promise<boolean> {
  if (termination.platform === "win32") {
    const terminated = await taskkillPackageWorkerTree(child.pid, termination);
    if (!terminated && isChildRunning(child)) child.kill();
    return terminated;
  }
  const signal: NodeJS.Signals = termination.force ? "SIGKILL" : "SIGTERM";
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return false;
    } catch {
      // Fall back to the direct child if the process group was not established.
    }
  }
  if (isChildRunning(child)) child.kill(signal);
  return false;
}

export async function inspectPackageWorkerProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform
): Promise<boolean> {
  if (child.pid === undefined) return isChildRunning(child);
  if (platform === "win32") {
    // Without a Job Object, a dead root PID cannot prove its descendants are gone.
    return true;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return nodeErrorCode(error) !== "ESRCH";
  }
}

function taskkillPackageWorkerTree(
  pid: number | undefined,
  termination: PackageWorkerProcessTreeTermination
): Promise<boolean> {
  if (pid === undefined) return Promise.resolve(false);
  const systemRoot = termination.environment.SystemRoot ?? termination.environment.WINDIR;
  if (!systemRoot) return Promise.resolve(false);
  const executable = join(systemRoot, "System32", "taskkill.exe");
  const arguments_ = ["/PID", String(pid), "/T", ...(termination.force ? ["/F"] : [])];
  return new Promise((resolvePromise) => {
    let settled = false;
    const utility = spawn(executable, arguments_, {
      stdio: "ignore",
      windowsHide: true,
      env: windowsProcessUtilityEnvironment(termination.environment)
    });
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      utility.removeAllListeners();
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      utility.kill();
      finish(false);
    }, Math.max(1, Math.min(2_000, termination.deadlineMs)));
    utility.once("error", () => finish(false));
    utility.once("exit", (code) => finish(code === 0));
  });
}

function windowsProcessUtilityEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["ComSpec", "PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"] as const) {
    copyEnvironmentValue(source, environment, key);
  }
  return environment;
}

function copyEnvironmentValue(
  source: NodeJS.ProcessEnv,
  destination: NodeJS.ProcessEnv,
  key: string
): void {
  const value = source[key];
  if (typeof value === "string") destination[key] = value;
}

function settlesWithin(promise: Promise<void>, milliseconds: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => finish(false), milliseconds);
    void promise.then(() => finish(true));
  });
}

async function waitForPackageWorkerTreeExit(
  child: ChildProcess,
  exited: Promise<void>,
  milliseconds: number,
  terminationConfirmed: boolean,
  platform: NodeJS.Platform,
  inspectProcessTree: PackageWorkerProcessTreeInspector
): Promise<boolean> {
  const startedAt = Date.now();
  if (terminationConfirmed && await settlesWithin(exited, milliseconds)) return true;
  while (Date.now() - startedAt < milliseconds) {
    if (!await inspectProcessTree(child, platform)) return true;
    const remaining = milliseconds - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await delay(Math.min(25, remaining));
  }
  return false;
}

function nodeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function packageWorkerTreeCleanupFailure(): HostCommandError {
  return new HostCommandError(
    "RUNTIME_POISONED",
    "The isolated Pi package worker process tree did not exit after forced termination.",
    false,
    { processTreeCleanup: false }
  );
}
