import { describe, expect, it } from "vitest";
import { runBoundedSkillPackProcess } from "./skill-pack-process-runner.js";

describe("runBoundedSkillPackProcess", () => {
  it("waits for process-tree cancellation before rejecting", async () => {
    const controller = new AbortController();
    const running = runBoundedSkillPackProcess(
      process.execPath,
      ["-e", "setInterval(() => undefined, 1_000)"],
      {
        cwd: process.cwd(),
        timeoutMs: 10_000,
        environment: process.env,
        signal: controller.signal
      }
    );

    controller.abort();

    await expect(running).rejects.toThrow("Skill Pack operation was cancelled.");
  });

  it("terminates a timed-out process before reporting the timeout", async () => {
    await expect(runBoundedSkillPackProcess(
      process.execPath,
      ["-e", "setInterval(() => undefined, 1_000)"],
      {
        cwd: process.cwd(),
        timeoutMs: 10,
        environment: process.env
      }
    )).rejects.toThrow("Skill Pack operation timed out.");
  });

  it("writes bounded credential input through stdin instead of argv", async () => {
    const input = Buffer.from("credential-input\n", "utf8");
    const result = await runBoundedSkillPackProcess(
      process.execPath,
      ["-e", "let size=0;process.stdin.on('data',(chunk)=>{size+=chunk.length});process.stdin.on('end',()=>process.stdout.write(String(size)))"],
      {
        cwd: process.cwd(),
        timeoutMs: 10_000,
        environment: process.env,
        stdin: input
      }
    );

    expect(result.stdout).toBe(String(input.length));
  });

  it("observes bounded process output before the process exits", async () => {
    let resolveObserved!: (value: string) => void;
    const observed = new Promise<string>((resolve) => { resolveObserved = resolve; });
    const running = runBoundedSkillPackProcess(
      process.execPath,
      ["-e", "process.stderr.write('open https://open.feishu.cn/setup\\n');setTimeout(()=>process.exit(0),100)"],
      {
        cwd: process.cwd(),
        timeoutMs: 10_000,
        environment: process.env,
        onOutput: ({ chunk }) => resolveObserved(Buffer.from(chunk).toString("utf8"))
      }
    );

    await expect(observed).resolves.toContain("https://open.feishu.cn/setup");
    await expect(running).resolves.toMatchObject({ stderr: expect.stringContaining("https://open.feishu.cn/setup") });
  });
});
