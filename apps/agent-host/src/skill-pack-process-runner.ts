import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPackageWorkerProcessTreeController,
  inspectPackageWorkerProcessTree,
  terminateAndWaitForPackageWorkerProcessTree,
  terminatePackageWorkerProcessTree
} from "./package-worker-process-tree.js";
import { HostCommandError } from "./protocol-error.js";
import {
  isSkillPackProcessWorkerOutput,
  isSkillPackProcessWorkerResponse,
  type SkillPackProcessWorkerRequest
} from "./skill-pack-process-worker-protocol.js";
import {
  appendBoundedProcessOutput,
  decodeSkillPackProcessOutput,
  windowsCommandShellInvocation
} from "./skill-pack-process-execution.js";

export { MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES } from "./skill-pack-process-execution.js";
const PROCESS_TREE_TERMINATION_DEADLINE_MS = 4_000;
const skillPackProcessWorkerEntry = fileURLToPath(new URL("./skill-pack-process-worker.mjs", import.meta.url));

export type SkillPackProcessRunner = (
  executable: string,
  arguments_: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    environment: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    stdin?: Uint8Array;
    onOutput?: (output: { stream: "stdout" | "stderr"; chunk: Uint8Array }) => void;
  }
) => Promise<{ stdout: string; stderr: string }>;

export const runBoundedSkillPackProcess: SkillPackProcessRunner = (
  executable,
  arguments_,
  options
) => process.platform === "win32"
  ? runWindowsContainedSkillPackProcess(executable, arguments_, options)
  : runDirectSkillPackProcess(executable, arguments_, options);

const runDirectSkillPackProcess: SkillPackProcessRunner = (
  executable,
  arguments_,
  options
) => new Promise((resolve, reject) => {
  const useCommandShell = process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(executable);
  const shellInvocation = useCommandShell
    ? windowsCommandShellInvocation(executable, arguments_, options.environment.ComSpec)
    : undefined;
  const command = shellInvocation?.command ?? executable;
  const commandArguments = shellInvocation?.arguments ?? arguments_;
  const child = spawn(command, commandArguments, {
    cwd: options.cwd,
    stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsVerbatimArguments: shellInvocation?.windowsVerbatimArguments ?? false,
    windowsHide: true,
    env: {
      ...options.environment,
      NO_COLOR: "1",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never"
    }
  });
  let stdout: Buffer = Buffer.alloc(0);
  let stderr: Buffer = Buffer.alloc(0);
  let settled = false;
  let terminating = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let markExited!: () => void;
  const exited = new Promise<void>((resolveExited) => { markExited = resolveExited; });
  const settle = (callback: () => void) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    callback();
  };
  const terminate = (message: string) => {
    if (settled || terminating) return;
    terminating = true;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    void terminateAndWaitForPackageWorkerProcessTree(
      child,
      exited,
      PROCESS_TREE_TERMINATION_DEADLINE_MS,
      process.platform,
      options.environment,
      terminatePackageWorkerProcessTree,
      inspectPackageWorkerProcessTree
    ).then(
      () => settle(() => reject(new Error(message))),
      (error: unknown) => settle(() => reject(error))
    );
  };
  const onAbort = () => terminate("Skill Pack operation was cancelled.");
  child.stdout!.on("data", (chunk: Buffer) => {
    stdout = appendAndObserveProcessOutput(stdout, chunk, "stdout", options.onOutput);
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr = appendAndObserveProcessOutput(stderr, chunk, "stderr", options.onOutput);
  });
  if (child.stdin) {
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin);
  }
  child.once("error", (error) => {
    markExited();
    if (!terminating) settle(() => reject(error));
  });
  child.once("exit", (code, signal) => {
    markExited();
    if (terminating) return;
    settle(() => {
      const decodedStdout = decodeSkillPackProcessOutput(stdout);
      const decodedStderr = decodeSkillPackProcessOutput(stderr);
      if (code === 0) resolve({ stdout: decodedStdout, stderr: decodedStderr });
      else reject(new Error(
        `${basename(executable)} exited with ${signal ?? code}: ${boundedProcessMessage(decodedStderr || decodedStdout) ?? "no output"}`
      ));
    });
  });
  options.signal?.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => {
    terminate("Skill Pack operation timed out.");
  }, options.timeoutMs);
  if (options.signal?.aborted) onAbort();
});

const runWindowsContainedSkillPackProcess: SkillPackProcessRunner = (
  executable,
  arguments_,
  options
) => new Promise((resolve, reject) => {
  const electronExecutable = options.environment.PI67_ELECTRON_EXECUTABLE;
  if (!electronExecutable || !options.environment.PI67_WINDOWS_JOB_CONTROLLER) {
    reject(new HostCommandError(
      "TOOLCHAIN_INTEGRITY_FAILED",
      "Windows Skill Pack process containment is unavailable.",
      false,
      { containmentEstablished: false, requestDispatched: false }
    ));
    return;
  }
  const requestId = randomUUID();
  const environment = stringEnvironment({
    ...options.environment,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never"
  });
  const request: SkillPackProcessWorkerRequest = {
    type: "skill-pack-process-request",
    requestId,
    executable,
    arguments: arguments_,
    cwd: options.cwd,
    environment,
    ...(options.stdin === undefined ? {} : { stdinBase64: Buffer.from(options.stdin).toString("base64") })
  };
  let child: ChildProcess;
  try {
    child = spawn(electronExecutable, [skillPackProcessWorkerEntry], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: environment,
      windowsHide: true
    });
  } catch (error) {
    reject(error);
    return;
  }
  const processTree = createPackageWorkerProcessTreeController("win32", options.environment);
  let finalizing = false;
  let timer: NodeJS.Timeout | undefined;
  let markExited!: () => void;
  const exited = new Promise<void>((resolveExited) => { markExited = resolveExited; });
  const cleanup = (): void => {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    child.removeAllListeners();
    if (child.connected) {
      try {
        child.disconnect();
      } catch {
        // The process-tree controller remains authoritative for final cleanup.
      }
    }
  };
  const finish = (operation: () => void): void => {
    if (finalizing) return;
    finalizing = true;
    if (timer) clearTimeout(timer);
    void terminateAndWaitForPackageWorkerProcessTree(
      child,
      exited,
      PROCESS_TREE_TERMINATION_DEADLINE_MS,
      "win32",
      options.environment,
      processTree.terminate,
      processTree.inspect
    ).then(
      async () => {
        await processTree.dispose();
        operation();
      },
      async (error: unknown) => {
        await processTree.dispose().catch(() => undefined);
        reject(error);
      }
    ).finally(cleanup);
  };
  const onAbort = (): void => finish(() => reject(new Error("Skill Pack operation was cancelled.")));

  child.once("error", (error) => {
    if (child.pid === undefined) markExited();
    finish(() => reject(error));
  });
  child.once("exit", (code, signal) => {
    markExited();
    finish(() => reject(new Error(
      `Skill Pack process worker exited before responding (${signal ?? code}).`
    )));
  });
  child.on("message", (message: unknown) => {
    if (isSkillPackProcessWorkerOutput(message, requestId)) {
      notifyProcessOutput(options.onOutput, {
        stream: message.stream,
        chunk: Buffer.from(message.chunkBase64, "base64")
      });
      return;
    }
    if (!isSkillPackProcessWorkerResponse(message, requestId)) return;
    if (message.ok) finish(() => resolve({ stdout: message.stdout, stderr: message.stderr }));
    else finish(() => reject(new Error(message.message)));
  });

  void processTree.attach(child).then(() => {
    if (finalizing) return;
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => finish(() => reject(new Error("Skill Pack operation timed out."))), options.timeoutMs);
    timer.unref?.();
    if (!child.send) {
      finish(() => reject(new Error("Skill Pack process request could not be delivered.")));
      return;
    }
    try {
      child.send(request, (error) => {
        if (error) finish(() => reject(new Error("Skill Pack process request could not be delivered.")));
      });
    } catch {
      finish(() => reject(new Error("Skill Pack process request could not be delivered.")));
    }
  }).catch((error: unknown) => finish(() => reject(error)));
});

function appendAndObserveProcessOutput(
  current: Buffer,
  chunk: Buffer,
  stream: "stdout" | "stderr",
  observer: Parameters<SkillPackProcessRunner>[2]["onOutput"]
): Buffer {
  const next = appendBoundedProcessOutput(current, chunk);
  const appended = next.subarray(current.byteLength);
  if (appended.byteLength > 0) notifyProcessOutput(observer, { stream, chunk: appended });
  return next;
}

function notifyProcessOutput(
  observer: Parameters<SkillPackProcessRunner>[2]["onOutput"],
  output: { stream: "stdout" | "stderr"; chunk: Uint8Array }
): void {
  try {
    observer?.(output);
  } catch {
    // Output observation must not weaken process completion or cleanup authority.
  }
}

function boundedProcessMessage(value: string): string | undefined {
  let sanitized = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    sanitized += code <= 31 || code === 127 ? " " : character;
  }
  const normalized = sanitized.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, 1_000) : undefined;
}

function stringEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
