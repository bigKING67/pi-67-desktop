import { spawn } from "node:child_process";
import { basename } from "node:path";
import {
  isSkillPackProcessWorkerRequest,
  type SkillPackProcessWorkerOutput,
  type SkillPackProcessWorkerResponse
} from "./skill-pack-process-worker-protocol.js";
import {
  appendBoundedProcessOutput,
  decodeSkillPackProcessOutput,
  windowsCommandShellArguments
} from "./skill-pack-process-execution.js";

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
    ? windowsCommandShellArguments(message.executable, message.arguments)
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
  let stdout: Buffer = Buffer.alloc(0);
  let stderr: Buffer = Buffer.alloc(0);
  let settled = false;
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = appendAndForward(message.requestId, stdout, chunk, "stdout");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = appendAndForward(message.requestId, stderr, chunk, "stderr");
  });
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
    const decodedStdout = decodeSkillPackProcessOutput(stdout, "win32");
    const decodedStderr = decodeSkillPackProcessOutput(stderr, "win32");
    if (code === 0) {
      send({
        type: "skill-pack-process-response",
        requestId: message.requestId,
        ok: true,
        stdout: decodedStdout,
        stderr: decodedStderr
      });
      return;
    }
    send({
      type: "skill-pack-process-response",
      requestId: message.requestId,
      ok: false,
      message: `${basename(message.executable)} exited with ${signal ?? code}: ${boundedMessage(decodedStderr || decodedStdout)}`
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

function appendAndForward(
  requestId: string,
  current: Buffer,
  chunk: Buffer,
  stream: SkillPackProcessWorkerOutput["stream"]
): Buffer {
  const next = appendBoundedProcessOutput(current, chunk);
  const appended = next.subarray(current.byteLength);
  if (appended.byteLength > 0) sendOutput({
    type: "skill-pack-process-output",
    requestId,
    stream,
    chunkBase64: appended.toString("base64")
  });
  return next;
}

function sendOutput(output: SkillPackProcessWorkerOutput): void {
  process.send?.(output);
}

function send(response: SkillPackProcessWorkerResponse): void {
  if (!process.send) return;
  process.send(response, undefined, undefined, () => process.disconnect());
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
