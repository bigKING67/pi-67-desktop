import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import {
  GitInspectionError,
  type GitInspectionStage
} from "./worktree-git-contract.js";

const TERMINATION_GRACE_MS = 250;
export type GitChild = ChildProcessByStdio<null, Readable, Readable>;

export async function captureGitProcess(options: {
  child: GitChild;
  stage: GitInspectionStage;
  timeoutMs: number;
  outputLimitBytes: number;
  signal: AbortSignal;
  platform: NodeJS.Platform;
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
    if (result.code !== 0) {
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
    if (!(error instanceof GitInspectionError) || closed) throw error;
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
    child.kill();
    if (await closesWithin(closePromise, TERMINATION_GRACE_MS)) return true;
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const taskkill = spawn(`${systemRoot}\\System32\\taskkill.exe`, ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
    await new Promise<void>((resolvePromise) => taskkill.once("close", () => resolvePromise()));
    return closesWithin(closePromise, TERMINATION_GRACE_MS);
  }

  signalProcessGroup(pid, "SIGTERM");
  if (await closesWithin(closePromise, TERMINATION_GRACE_MS) && !processGroupExists(pid)) return true;
  signalProcessGroup(pid, "SIGKILL");
  await closesWithin(closePromise, TERMINATION_GRACE_MS);
  return !processGroupExists(pid);
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
  return Promise.race([
    closePromise.then(() => true, () => true),
    new Promise<boolean>((resolvePromise) => setTimeout(() => resolvePromise(false), timeoutMs))
  ]);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
