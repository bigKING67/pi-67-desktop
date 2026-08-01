import { spawn } from "node:child_process";
import { basename } from "node:path";

export const MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES = 64 * 1024;

export type SkillPackProcessRunner = (
  executable: string,
  arguments_: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    environment: NodeJS.ProcessEnv;
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
    stdio: ["ignore", "pipe", "pipe"],
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
  let timer: ReturnType<typeof setTimeout>;
  const settle = (callback: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback();
  };
  const capture = (current: string, chunk: Buffer): string => (
    current.length >= MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES
      ? current
      : current + chunk.toString("utf8").slice(0, MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES - current.length)
  );
  child.stdout.on("data", (chunk: Buffer) => { stdout = capture(stdout, chunk); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = capture(stderr, chunk); });
  child.once("error", (error) => settle(() => reject(error)));
  child.once("exit", (code, signal) => settle(() => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(
      `${basename(executable)} exited with ${signal ?? code}: ${boundedProcessMessage(stderr || stdout) ?? "no output"}`
    ));
  }));
  timer = setTimeout(() => {
    child.kill();
    settle(() => reject(new Error("Skill Pack operation timed out.")));
  }, options.timeoutMs);
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
