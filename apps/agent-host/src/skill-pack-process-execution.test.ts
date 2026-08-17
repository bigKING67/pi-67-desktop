import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendBoundedProcessOutput,
  decodeSkillPackProcessOutput,
  windowsCommandShellArguments,
  windowsCommandShellInvocation
} from "./skill-pack-process-execution.js";

describe("Skill Pack process execution", () => {
  it("preserves cmd executable and argument quotes behind the /s outer pair", () => {
    expect(windowsCommandShellArguments(
      "C:\\Users\\Fixture User\\bin\\lark-cli.cmd",
      ["update", "--check", "--json"]
    )).toEqual([
      "/d",
      "/s",
      "/c",
      "\"\"C:\\Users\\Fixture User\\bin\\lark-cli.cmd\" \"update\" \"--check\" \"--json\"\""
    ]);
  });

  it("keeps the complete cmd invocation verbatim for Node spawn", () => {
    expect(windowsCommandShellInvocation(
      "C:\\Users\\Fixture User\\bin\\lark-cli.cmd",
      ["update check"],
      "C:\\Windows\\System32\\cmd.exe"
    )).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      arguments: [
        "/d",
        "/s",
        "/c",
        "\"\"C:\\Users\\Fixture User\\bin\\lark-cli.cmd\" \"update check\"\""
      ],
      windowsVerbatimArguments: true
    });
  });

  it("decodes native Chinese Windows command output without mojibake", () => {
    const gb18030 = Buffer.from(
      "b2bbcac7c4dab2bfbbf2cde2b2bfc3fcc1eea3acd2b2b2bbcac7bfc9d4cbd0d0b5c4b3ccd0f2bbf2c5fab4a6c0edcec4bcfea1a3",
      "hex"
    );
    expect(decodeSkillPackProcessOutput(gb18030, "win32"))
      .toBe("不是内部或外部命令，也不是可运行的程序或批处理文件。");
  });

  it("keeps output byte-bounded without exposing a partial UTF-8 code point", () => {
    const captured = appendBoundedProcessOutput(
      Buffer.from("ok ", "utf8"),
      Buffer.from("中文", "utf8"),
      5
    );
    expect(captured.byteLength).toBe(5);
    expect(decodeSkillPackProcessOutput(captured)).toBe("ok ");
  });

  it.runIf(process.platform === "win32")(
    "executes a cmd shim from a path containing spaces",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "pi67 cmd shim "));
      const shim = join(root, "lark-cli.cmd");
      await writeFile(shim, [
        "@echo off",
        "if not \"%~1\"==\"update check\" exit /b 7",
        "echo {\"ok\":true}"
      ].join("\r\n"), "utf8");

      const result = await runWindowsCommand(shim, ["update check"]);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe("{\"ok\":true}");
      expect(result.stderr).toBe("");
    }
  );
});

function runWindowsCommand(
  executable: string,
  arguments_: string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const invocation = windowsCommandShellInvocation(executable, arguments_, process.env.ComSpec);
    const child = spawn(invocation.command, invocation.arguments, {
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    child.stdout.on("data", (chunk: Buffer) => { stdout = appendBoundedProcessOutput(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = appendBoundedProcessOutput(stderr, chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({
      code,
      stdout: decodeSkillPackProcessOutput(stdout, "win32"),
      stderr: decodeSkillPackProcessOutput(stderr, "win32")
    }));
  });
}
