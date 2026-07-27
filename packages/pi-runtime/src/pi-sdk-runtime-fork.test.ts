import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@pi67/protocol";
import { afterEach, describe, expect, it } from "vitest";
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
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("PiSdkRuntime Session fork", () => {
  it("separates new-file fork authority from same-file incremental navigation", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-fork-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions");
    await Promise.all([
      mkdir(cwd),
      mkdir(sessionDirectory, { recursive: true })
    ]);

    const fixture = SessionManager.create(cwd, sessionDirectory);
    const userEntryId = fixture.appendMessage({
      role: "user",
      content: "Fork this session.",
      timestamp: Date.now()
    });
    const assistantEntryId = fixture.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Fork source response." }],
      api: "openai-responses",
      provider: "pi67-test",
      model: "fixture",
      usage: zeroUsage,
      stopReason: "stop",
      timestamp: Date.now() + 1
    });
    const sessionPath = fixture.getSessionFile();
    if (!sessionPath) throw new Error("Fork fixture must be persisted.");

    const runtime = new PiSdkRuntime();
    const events: AgentEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    try {
      const original = await runtime.initialize({
        cwd,
        agentDir,
        sessionPath,
        trust: "unknown",
        approvalMode: "guided"
      });
      const originalIdentity = runtime.getIdentity();
      events.length = 0;

      const forked = await runtime.forkSession(assistantEntryId);

      expect(forked.sessionId).not.toBe(original.sessionId);
      expect(forked.sessionPath).not.toBe(original.sessionPath);
      expect(forked.messages).toHaveLength(2);
      expect(runtime.getIdentity()).toEqual({
        sessionId: forked.sessionId,
        sessionPath: forked.sessionPath,
        sessionGeneration: originalIdentity.sessionGeneration + 1
      });
      expect(events.some((event) => event.type === "conversation.changed")).toBe(false);

      events.length = 0;
      const forkIdentity = runtime.getIdentity();
      await runtime.rollback(userEntryId, false);

      expect(runtime.getIdentity()).toEqual(forkIdentity);
      expect(events.map((event) => event.type)).toEqual([
        "conversation.changed",
        "tree.changed",
        "usage.changed"
      ]);
      expect(runtime.getSnapshot().messages).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  }, 15_000);
});
