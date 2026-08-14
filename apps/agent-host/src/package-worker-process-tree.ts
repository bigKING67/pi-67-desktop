import type { ChildProcess } from "node:child_process";
import type {
  PackageWorkerProcessTreeController,
  PackageWorkerProcessTreeInspector,
  PackageWorkerProcessTreeTerminator
} from "./package-worker-process-tree-contract.js";
import { HostCommandError } from "./protocol-error.js";
import {
  createWindowsPackageWorkerProcessTreeController,
  inspectWindowsPackageWorkerProcessTree,
  terminateWindowsPackageWorkerProcessTree
} from "./windows-package-worker-process-tree.js";

export type {
  PackageWorkerProcessTreeController,
  PackageWorkerProcessTreeInspector,
  PackageWorkerProcessTreeTerminator
} from "./package-worker-process-tree-contract.js";

export function createPackageWorkerProcessTreeController(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  spawnController?: Parameters<typeof createWindowsPackageWorkerProcessTreeController>[1]
): PackageWorkerProcessTreeController {
  if (platform === "win32") {
    return createWindowsPackageWorkerProcessTreeController(environment, spawnController);
  }
  return {
    attach: async () => undefined,
    terminate: terminatePackageWorkerProcessTree,
    inspect: inspectPackageWorkerProcessTree,
    dispose: async () => undefined
  };
}

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
  termination: Parameters<PackageWorkerProcessTreeTerminator>[1]
): Promise<boolean> {
  if (termination.platform === "win32") {
    return terminateWindowsPackageWorkerProcessTree(child, termination);
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
  if (platform === "win32") return inspectWindowsPackageWorkerProcessTree();
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return nodeErrorCode(error) !== "ESRCH";
  }
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
  if (
    terminationConfirmed
    && (!isChildRunning(child) || await settlesWithin(exited, Math.min(25, milliseconds)))
  ) return true;
  while (Date.now() - startedAt < milliseconds) {
    const remaining = milliseconds - (Date.now() - startedAt);
    if (remaining <= 0) break;
    if (!await inspectProcessTree(child, platform, remaining)) return true;
    if (terminationConfirmed && !isChildRunning(child)) return true;
    const afterInspection = milliseconds - (Date.now() - startedAt);
    if (afterInspection <= 0) break;
    await delay(Math.min(25, afterInspection));
  }
  return false;
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

function nodeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isChildRunning(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

function packageWorkerTreeCleanupFailure(): HostCommandError {
  return new HostCommandError(
    "RUNTIME_POISONED",
    "The isolated Pi package worker process tree did not exit after forced termination.",
    false,
    { processTreeCleanup: false }
  );
}
