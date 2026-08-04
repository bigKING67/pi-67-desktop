import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";

const temporaryDirectories: string[] = [];
const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiSdkRuntime shutdown", () => {
  it("disposes an active Extension command, reaps its child process and preserves valid JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-shutdown-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    const childPidPath = join(root, "child.pid");
    const lifecyclePath = join(root, "lifecycle.txt");
    await Promise.all([mkdir(cwd), mkdir(extensionsDirectory, { recursive: true })]);
    await writeFile(join(extensionsDirectory, "shutdown-fixture.ts"), `
      import { appendFileSync, writeFileSync } from "node:fs";
      import { spawn } from "node:child_process";

      export default function shutdownFixture(pi) {
        let child;
        const stopChild = () => {
          if (child && child.exitCode === null && child.signalCode === null) child.kill();
        };
        pi.on("session_shutdown", (event) => {
          appendFileSync(${JSON.stringify(lifecyclePath)}, "shutdown:" + event.reason + "\\n");
          stopChild();
        });
        pi.registerProvider("pi67-shutdown", {
          baseUrl: "https://pi67.invalid",
          apiKey: "pi67-shutdown-fixture",
          api: "openai-responses",
          models: [{
            id: "fixture",
            name: "Shutdown fixture",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 4096,
            maxTokens: 256
          }]
        });
        pi.on("session_start", async (_event, ctx) => {
          const model = ctx.modelRegistry.find("pi67-shutdown", "fixture");
          if (model) await pi.setModel(model);
        });
        pi.registerCommand("hold-open", {
          description: "Start a controlled child process until Pi shuts down",
          handler: async (_args, ctx) => {
            pi.appendEntry("pi67-shutdown-fixture", { active: true });
            child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
              stdio: "ignore"
            });
            writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
            ctx.signal?.addEventListener("abort", stopChild, { once: true });
            await new Promise((resolve) => child.once("exit", resolve));
          }
        });
      }
    `, "utf8");

    const runtime = new PiSdkRuntime();
    const restoredRuntime = new PiSdkRuntime();
    let childPid: number | undefined;
    try {
      await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
      const initialPath = runtime.getIdentity().sessionPath;
      if (!initialPath) throw new Error("Pi runtime did not project a managed session path.");
      await mkdir(dirname(initialPath), { recursive: true });
      const fixture = SessionManager.create(cwd, dirname(initialPath));
      fixture.appendSessionInfo("Shutdown fixture");
      fixture.appendMessage({ role: "user", content: "Shutdown fixture", timestamp: Date.now() });
      fixture.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Fixture ready." }],
        api: "openai-responses",
        provider: "pi67-test",
        model: "fixture",
        usage: zeroUsage,
        stopReason: "stop",
        timestamp: Date.now() + 1
      });
      const sessionPath = fixture.getSessionFile();
      if (!sessionPath) throw new Error("Shutdown fixture was not persisted.");
      await runtime.openSession(sessionPath, cwd);

      const invocation = runtime.invokeCommand("hold-open");
      await vi.waitFor(async () => {
        childPid = Number(await readFile(childPidPath, "utf8"));
        expect(Number.isSafeInteger(childPid)).toBe(true);
        expect(isProcessAlive(childPid!)).toBe(true);
      }, { timeout: 5_000 });

      await runtime.dispose();
      await expect(invocation).resolves.toBeUndefined();
      await vi.waitFor(() => expect(isProcessAlive(childPid!)).toBe(false), { timeout: 5_000 });

      expect(await readFile(lifecyclePath, "utf8")).toContain("shutdown:quit");
      const lines = (await readFile(sessionPath, "utf8")).trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      expect(() => lines.map((line) => JSON.parse(line) as unknown)).not.toThrow();

      const stages: string[] = [];
      const restored = await restoredRuntime.initialize({
        cwd,
        agentDir,
        sessionPath,
        trust: "trusted",
        approvalMode: "guided"
      }, (stage) => stages.push(stage));
      expect(restoredRuntime.getIdentity().sessionPath).toBe(await realpath(sessionPath));
      expect(restored.messages).toHaveLength(2);
      expect(stages).toEqual([
        "resolve-session",
        "dispose-current",
        "create-session",
        "reload-configuration",
        "update-catalog",
        "project-snapshot"
      ]);
    } finally {
      await runtime.dispose();
      await restoredRuntime.dispose();
      if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
    }
  }, 15_000);
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
