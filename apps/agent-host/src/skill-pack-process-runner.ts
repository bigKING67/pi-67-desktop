import { spawn } from "node:child_process";
import { basename } from "node:path";
import {
  inspectPackageWorkerProcessTree,
  terminateAndWaitForPackageWorkerProcessTree,
  terminatePackageWorkerProcessTree
} from "./package-worker-process-tree.js";

export const MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES = 64 * 1024;
const PROCESS_TREE_TERMINATION_DEADLINE_MS = 1_500;

export type SkillPackProcessRunner = (
  executable: string,
  arguments_: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    environment: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    stdin?: Uint8Array;
  }
) => Promise<{ stdout: string; stderr: string }>;

export const runBoundedSkillPackProcess: SkillPackProcessRunner = (
  executable,
  arguments_,
  options
) => new Promise((resolve, reject) => {
  const useCommandShell = process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(executable);
  const command = useCommandShell ? options.environment.ComSpec ?? "cmd.exe" : executable;
  const commandArguments = useCommandShell
    ? ["/d", "/s", "/c", windowsCommand(executable, arguments_)]
    : arguments_;
  const child = spawn(command, commandArguments, {
    cwd: options.cwd,
    stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
    env: {
      ...options.environment,
      NO_COLOR: "1",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never"
    }
  });
  let stdout = "";
  let stderr = "";
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
  const capture = (current: string, chunk: Buffer): string => (
    current.length >= MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES
      ? current
      : current + chunk.toString("utf8").slice(0, MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES - current.length)
  );
  child.stdout!.on("data", (chunk: Buffer) => { stdout = capture(stdout, chunk); });
  child.stderr!.on("data", (chunk: Buffer) => { stderr = capture(stderr, chunk); });
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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(
        `${basename(executable)} exited with ${signal ?? code}: ${boundedProcessMessage(stderr || stdout) ?? "no output"}`
      ));
    });
  });
  options.signal?.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => {
    terminate("Skill Pack operation timed out.");
  }, options.timeoutMs);
  if (options.signal?.aborted) onAbort();
});

function windowsCommand(executable: string, arguments_: string[]): string {
  const quote = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`;
  return [executable, ...arguments_].map(quote).join(" ");
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
