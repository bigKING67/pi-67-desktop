import { spawn } from "node:child_process";
import { basename } from "node:path";
import {
  isSkillPackProcessWorkerRequest,
  type SkillPackProcessWorkerResponse
} from "./skill-pack-process-worker-protocol.js";

const MAX_OUTPUT_BYTES = 64 * 1024;

process.once("message", (message: unknown) => {
  if (!isSkillPackProcessWorkerRequest(message)) {
    send({
      type: "skill-pack-process-response",
      requestId: "invalid",
      ok: false,
      message: "Skill Pack process request is invalid."
    });
    return;
  }
  const useCommandShell = /\.(?:cmd|bat)$/iu.test(message.executable);
  const command = useCommandShell ? message.environment.ComSpec ?? "cmd.exe" : message.executable;
  const arguments_ = useCommandShell
    ? ["/d", "/s", "/c", windowsCommand(message.executable, message.arguments)]
    : message.arguments;
  let child;
  try {
    child = spawn(command, arguments_, {
      cwd: message.cwd,
      stdio: [message.stdinBase64 === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
      env: message.environment
    });
  } catch (error) {
    sendFailure(message.requestId, error);
    return;
  }
  let stdout = "";
  let stderr = "";
  let settled = false;
  const capture = (current: string, chunk: Buffer): string => (
    current.length >= MAX_OUTPUT_BYTES
      ? current
      : current + chunk.toString("utf8").slice(0, MAX_OUTPUT_BYTES - current.length)
  );
  child.stdout?.on("data", (chunk: Buffer) => { stdout = capture(stdout, chunk); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr = capture(stderr, chunk); });
  if (child.stdin) {
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(message.stdinBase64!, "base64"));
  }
  child.once("error", (error) => {
    if (settled) return;
    settled = true;
    sendFailure(message.requestId, error);
  });
  child.once("exit", (code, signal) => {
    if (settled) return;
    settled = true;
    if (code === 0) {
      send({
        type: "skill-pack-process-response",
        requestId: message.requestId,
        ok: true,
        stdout,
        stderr
      });
      return;
    }
    send({
      type: "skill-pack-process-response",
      requestId: message.requestId,
      ok: false,
      message: `${basename(message.executable)} exited with ${signal ?? code}: ${boundedMessage(stderr || stdout)}`
    });
  });
});

function sendFailure(requestId: string, error: unknown): void {
  send({
    type: "skill-pack-process-response",
    requestId,
    ok: false,
    message: boundedMessage(error instanceof Error ? error.message : "process start failed")
  });
}

function send(response: SkillPackProcessWorkerResponse): void {
  if (!process.send) return;
  process.send(response, undefined, undefined, () => process.disconnect());
}

function windowsCommand(executable: string, arguments_: string[]): string {
  const quote = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`;
  return [executable, ...arguments_].map(quote).join(" ");
}

function boundedMessage(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    sanitized += code <= 31 || code === 127 ? " " : character;
  }
  const normalized = sanitized.replace(/\s+/gu, " ").trim();
  return (normalized || "Skill Pack process failed.").slice(0, 1_000);
}
