import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";

describe("Pi SDK private memory Commit lifecycle", () => {
  it("routes the current Session only and removes stale owners on replacement and reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-memory-commit-"));
    const cwd = join(root, "workspace"), agentDir = join(root, "agent");
    const runtime = new PiSdkRuntime();
    try {
      await mkdir(cwd);
      await mkdir(join(agentDir, "extensions"), { recursive: true });
      await writeFile(join(agentDir, "extensions", "memory-fixture.ts"), `
        export default function memoryFixture(pi) {
          let sessionId;
          pi.on("session_start", (_event, ctx) => { sessionId = ctx.sessionManager.getSessionId(); });
          const unsubscribe = pi.events.on("pi67:private-memory:commit", data => {
            data.provide(async request => {
              if (request.sessionId !== sessionId || !request.canCommit()) throw new Error("wrong Session");
              return { status: "accepted", archived: false, task_id: sessionId };
            });
          });
          const stopInspect = pi.events.on("pi67:private-memory:inspect", data => {
            data.provide(async request => {
              if (request.sessionId !== sessionId || !request.isCurrent()) throw new Error("wrong Session");
              return { sessionId, owner: "pi67-openviking", privacyMode: "private-learning",
                capturedTurns: 4, pendingTokens: 10, liveTailTurns: 3, takeoverActive: true };
            });
          });
          pi.on("session_shutdown", () => { unsubscribe(); stopInspect(); });
        }
      `);
      const first = await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
      await expect(runtime.commitPrivateMemory(first.sessionId!)).resolves.toMatchObject({ task_id: first.sessionId });
      await expect(runtime.inspectPrivateMemory(first.sessionId!)).resolves.toMatchObject({ sessionId: first.sessionId, capturedTurns: 4 });
      await expect(runtime.commitPrivateMemory("not-current")).rejects.toThrow();
      const second = await runtime.createSession("session-creation-memory-commit");
      expect(second.sessionId).not.toBe(first.sessionId);
      await expect(runtime.inspectPrivateMemory(first.sessionId!)).rejects.toThrow();
      await expect(runtime.commitPrivateMemory(first.sessionId!)).rejects.toThrow();
      await expect(runtime.commitPrivateMemory(second.sessionId!)).resolves.toMatchObject({ task_id: second.sessionId });
      await runtime.reloadResources();
      await expect(runtime.inspectPrivateMemory(second.sessionId!)).resolves.toMatchObject({ sessionId: second.sessionId });
      await expect(runtime.commitPrivateMemory(second.sessionId!)).resolves.toMatchObject({ task_id: second.sessionId });
    } finally {
      await runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
