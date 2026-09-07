import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import {
  GitInspectionError,
  type GitInspectionStage
} from "./worktree-git-contract.js";

const TERMINATION_GRACE_MS = 250;
const TASKKILL_TIMEOUT_MS = 1000;
export type GitChild = ChildProcessByStdio<null, Readable, Readable>;

export async function captureGitProcess(options: {
  child: GitChild;
  stage: GitInspectionStage;
  timeoutMs: number;
  outputLimitBytes: number;
  signal: AbortSignal;
  platform: NodeJS.Platform;
  acceptedExitCodes?: readonly number[];
}): Promise<string> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let closed = false;
  let outputLimitExceeded = false;

  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise, reject) => {
    options.child.once("error", () => reject(new GitInspectionError(options.stage, "process-failed")));
    options.child.once("close", (code, signal) => {
      closed = true;
      resolvePromise({ code, signal });
    });
  });
  const outputLimitPromise = new Promise<never>((_resolve, reject) => {
    const capture = (target: Buffer[], chunk: Buffer, stream: "stdout" | "stderr") => {
      const currentBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
      if (currentBytes + chunk.byteLength > options.outputLimitBytes) {
        outputLimitExceeded = true;
        reject(new GitInspectionError(options.stage, "output-limit"));
        return;
      }
      target.push(chunk);
      if (stream === "stdout") stdoutBytes += chunk.byteLength;
      else stderrBytes += chunk.byteLength;
    };
    options.child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk, "stdout"));
    options.child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk, "stderr"));
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new GitInspectionError(options.stage, "timeout")), options.timeoutMs);
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    if (options.signal.aborted) {
      reject(new GitInspectionError(options.stage, "cancelled"));
      return;
    }
    options.signal.addEventListener(
      "abort",
      () => reject(new GitInspectionError(options.stage, "cancelled")),
      { once: true }
    );
  });

  try {
    const result = await Promise.race([closePromise, outputLimitPromise, timeoutPromise, abortPromise]);
    const acceptedExitCodes = options.acceptedExitCodes ?? [0];
    if (result.code === null || !acceptedExitCodes.includes(result.code)) {
      const stderrText = Buffer.concat(stderr).toString("utf8");
      const code = options.stage === "repository-root" && /not a git repository/iu.test(stderrText)
        ? "not-a-repository"
        : "process-failed";
      throw new GitInspectionError(options.stage, code, {
        ...(result.code === null ? {} : { exitCode: result.code }),
        ...(result.signal === null ? {} : { signal: result.signal })
      });
    }
    return Buffer.concat(stdout).toString("utf8");
  } catch (error) {
    if (!(error instanceof GitInspectionError)) throw error;
    if (closed) {
      if (options.platform === "win32" && ["cancelled", "timeout", "output-limit"].includes(error.code)) {
        throw new GitInspectionError(error.stage, error.code, { ...error.details, cleanupConfirmed: false });
      }
      throw error;
    }
    const cleanupConfirmed = await terminateGitProcessTree(
      options.child,
      closePromise,
      () => closed,
      options.platform
    );
    throw new GitInspectionError(error.stage, error.code, {
      ...error.details,
      cleanupConfirmed
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    if (outputLimitExceeded) {
      options.child.stdout.removeAllListeners("data");
      options.child.stderr.removeAllListeners("data");
    }
  }
}

async function terminateGitProcessTree(
  child: GitChild,
  closePromise: Promise<unknown>,
  isClosed: () => boolean,
  platform: NodeJS.Platform
): Promise<boolean> {
  if (isClosed()) return true;
  const pid = child.pid;
  if (!pid) return false;
  if (platform === "win32") {
    // Keep the root alive until taskkill has located its descendants.
    const gentle = await runTaskkill(pid, false);
    if (gentle && await closesWithin(closePromise, TERMINATION_GRACE_MS)) return true;
    // A dead root is no longer a reliable target for another tree traversal.
    if (isClosed()) return false;
    const forced = await runTaskkill(pid, true);
    return forced && await closesWithin(closePromise, TERMINATION_GRACE_MS);
  }

  signalProcessGroup(pid, "SIGTERM");
  if (await closesWithin(closePromise, TERMINATION_GRACE_MS) && !processGroupExists(pid)) return true;
  signalProcessGroup(pid, "SIGKILL");
  await closesWithin(closePromise, TERMINATION_GRACE_MS);
  return !processGroupExists(pid);
}

function runTaskkill(pid: number, force: boolean): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    let taskkill: ReturnType<typeof spawn>;
    try {
      taskkill = spawn(`${systemRoot}\\System32\\taskkill.exe`, ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], {
        shell: false,
        stdio: "ignore",
        windowsHide: true
      });
    } catch {
      resolvePromise(false);
      return;
    }
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(success);
    };
    const timeout = setTimeout(() => {
      finish(false);
      try { taskkill.kill(); } catch { /* Cleanup remains unconfirmed. */ }
    }, TASKKILL_TIMEOUT_MS);
    taskkill.once("error", () => finish(false));
    taskkill.once("close", (code) => finish(code === 0));
  });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!isNodeError(error, "ESRCH")) throw error;
  }
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

async function closesWithin(closePromise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      closePromise.then(() => true, () => false),
      new Promise<boolean>((resolvePromise) => { timer = setTimeout(() => resolvePromise(false), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
