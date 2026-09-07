import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBoundedSkillPackProcess } from "./skill-pack-process-runner.js";

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

describe.skipIf(process.platform === "win32")("Skill Pack POSIX descendant completion", () => {
  it.each([0, 1])("reaps same-group helpers before reporting root exit %s", async (code) => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-pack-descendants-"));
    const identity = join(directory, "identity.json");
    let pids: { root: number; descendant: number } | undefined;
    try {
      const result = runBoundedSkillPackProcess(process.execPath, ["-e", `
        const {spawn}=require('node:child_process');
        const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});
        require('node:fs').writeFileSync(${JSON.stringify(identity)},JSON.stringify({root:process.pid,descendant:child.pid}));
        process.stdout.write('complete-output');
        child.unref(); process.exitCode=${code};
      `], { cwd: directory, environment: process.env, timeoutMs: 10_000 });
      if (code === 0) await expect(result).resolves.toEqual({ stdout: "complete-output", stderr: "" });
      else await expect(result).rejects.toThrow("exited with 1: complete-output");
      pids = JSON.parse(await readFile(identity, "utf8"));
      expect(alive(pids!.root)).toBe(false);
      expect(alive(pids!.descendant)).toBe(false);
    } finally {
      pids ??= JSON.parse(await readFile(identity, "utf8"));
      try { process.kill(-pids!.root, "SIGKILL"); } catch { /* Already reaped. */ }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([false, true])("cancellation reaps helpers even with authorization preservation %s", async (preserve) => {
    const controller = new AbortController();
    let pids: { root: number; descendant: number } | undefined;
    try {
      const running = runBoundedSkillPackProcess(process.execPath, ["-e", `
        const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
        process.stdout.write(JSON.stringify({root:process.pid,descendant:child.pid}));
        setInterval(()=>{},1000);
      `], {
        cwd: tmpdir(), environment: process.env, timeoutMs: 10_000,
        preserveAuthorizationDescendants: preserve, signal: controller.signal,
        onOutput: ({ chunk }) => {
          pids = JSON.parse(Buffer.from(chunk).toString("utf8"));
          controller.abort();
        }
      });
      await expect(running).rejects.toThrow("Skill Pack operation was cancelled.");
      expect(pids).toBeDefined();
      expect(alive(pids!.root)).toBe(false);
      expect(alive(pids!.descendant)).toBe(false);
    } finally {
      if (pids) {
        try { process.kill(-pids.root, "SIGKILL"); } catch { /* Already reaped. */ }
      }
    }
  });

  it("fails within the close deadline when an escaped helper holds output pipes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-pack-pipes-"));
    const identity = join(directory, "identity.json");
    let pids: { root: number; descendant: number } | undefined;
    try {
      await expect(runBoundedSkillPackProcess(process.execPath, ["-e", `
        const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});
        require('node:fs').writeFileSync(${JSON.stringify(identity)},JSON.stringify({root:process.pid,descendant:child.pid}));
        child.unref();
      `], { cwd: directory, environment: process.env, timeoutMs: 10_000 }))
        .rejects.toThrow("Skill Pack output streams did not close after process cleanup.");
      pids = JSON.parse(await readFile(identity, "utf8"));
      expect(alive(pids!.root)).toBe(false);
      expect(alive(pids!.descendant)).toBe(true);
    } finally {
      pids ??= JSON.parse(await readFile(identity, "utf8"));
      try { process.kill(-pids!.descendant, "SIGKILL"); } catch { /* Already reaped. */ }
      await expect.poll(() => alive(pids!.descendant)).toBe(false);
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("preserves explicitly declared authorization descendants after natural exit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-pack-auth-"));
    const identity = join(directory, "identity.json");
    let pids: { root: number; descendant: number } | undefined;
    try {
      await runBoundedSkillPackProcess(process.execPath, ["-e", `
        const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
        require('node:fs').writeFileSync(${JSON.stringify(identity)},JSON.stringify({root:process.pid,descendant:child.pid}));
        child.unref();
      `], { cwd: directory, environment: process.env, timeoutMs: 10_000, preserveAuthorizationDescendants: true });
      pids = JSON.parse(await readFile(identity, "utf8"));
      expect(alive(pids!.descendant)).toBe(true);
    } finally {
      pids ??= JSON.parse(await readFile(identity, "utf8"));
      try { process.kill(-pids!.root, "SIGKILL"); } catch { /* Already reaped. */ }
      await expect.poll(() => alive(pids!.descendant)).toBe(false);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
