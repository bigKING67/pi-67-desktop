import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
    const fixture = await createForkFixture();

    const runtime = new PiSdkRuntime();
    const events: AgentEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    try {
      const original = await runtime.initialize({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        sessionPath: fixture.sessionPath,
        trust: "unknown",
        approvalMode: "guided"
      });
      const originalIdentity = runtime.getIdentity();
      const originalJsonl = await readFile(fixture.sessionPath, "utf8");
      events.length = 0;

      const forked = await runtime.forkSession(fixture.firstAssistantEntryId, "at");

      expect(forked.sessionId).not.toBe(original.sessionId);
      expect(forked.sessionPath).not.toBe(original.sessionPath);
      expect(forked.messages).toHaveLength(2);
      expect(await readFile(fixture.sessionPath, "utf8")).toBe(originalJsonl);
      expect(runtime.getIdentity()).toEqual({
        sessionId: forked.sessionId,
        sessionPath: forked.sessionPath,
        sessionGeneration: originalIdentity.sessionGeneration + 1
      });
      expect(events.some((event) => event.type === "conversation.changed")).toBe(false);

      events.length = 0;
      const forkIdentity = runtime.getIdentity();
      await runtime.rollback(fixture.firstUserEntryId, false);

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

  it("forks before a historical user message without changing the source JSONL", async () => {
    const fixture = await createForkFixture();
    const runtime = new PiSdkRuntime();
    try {
      const original = await runtime.initialize({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        sessionPath: fixture.sessionPath,
        trust: "unknown",
        approvalMode: "guided"
      });
      const originalIdentity = runtime.getIdentity();
      const originalJsonl = await readFile(fixture.sessionPath, "utf8");

      const forked = await runtime.forkSession(fixture.secondUserEntryId, "before");

      expect(forked.messages).toHaveLength(2);
      expect(forked.messages.map((message) => message.id)).not.toContain(fixture.secondUserEntryId);
      expect(forked.sessionId).not.toBe(original.sessionId);
      expect(forked.sessionPath).not.toBe(original.sessionPath);
      expect(runtime.getIdentity().sessionGeneration).toBe(originalIdentity.sessionGeneration + 1);
      expect(await readFile(fixture.sessionPath, "utf8")).toBe(originalJsonl);
    } finally {
      await runtime.dispose();
    }
  }, 15_000);

  it("creates an empty child Session when editing the first user message", async () => {
    const fixture = await createForkFixture();
    const runtime = new PiSdkRuntime();
    try {
      const original = await runtime.initialize({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        sessionPath: fixture.sessionPath,
        trust: "unknown",
        approvalMode: "guided"
      });
      const originalJsonl = await readFile(fixture.sessionPath, "utf8");

      const forked = await runtime.forkSession(fixture.firstUserEntryId, "before");

      expect(forked.messages).toEqual([]);
      expect(forked.sessionId).not.toBe(original.sessionId);
      expect(forked.sessionPath).not.toBe(original.sessionPath);
      expect(await readFile(fixture.sessionPath, "utf8")).toBe(originalJsonl);
    } finally {
      await runtime.dispose();
    }
  }, 15_000);

  it("copies a source Session into an independently writable target Runtime", async () => {
    const fixture = await createForkFixture();
    const sourceRuntime = new PiSdkRuntime();
    const targetRuntime = new PiSdkRuntime();
    try {
      await sourceRuntime.initialize({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        sessionPath: fixture.sessionPath,
        trust: "unknown",
        approvalMode: "guided"
      });
      await targetRuntime.initialize({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        trust: "unknown",
        approvalMode: "guided"
      });
      const sourceIdentity = sourceRuntime.getIdentity();
      const sourceJsonl = await readFile(fixture.sessionPath, "utf8");
      const targetIdentity = targetRuntime.getIdentity();

      const forked = await targetRuntime.forkSessionFrom(
        fixture.sessionPath,
        fixture.firstAssistantEntryId
      );

      expect(forked.messages.map((message) => message.id)).toEqual([
        fixture.firstUserEntryId,
        fixture.firstAssistantEntryId
      ]);
      expect(forked.sessionId).not.toBe(sourceIdentity.sessionId);
      expect(forked.sessionPath).not.toBe(sourceIdentity.sessionPath);
      expect(targetRuntime.getIdentity()).toEqual({
        sessionId: forked.sessionId,
        sessionPath: forked.sessionPath,
        sessionGeneration: targetIdentity.sessionGeneration + 1
      });
      expect(sourceRuntime.getIdentity()).toEqual(sourceIdentity);
      expect(await readFile(fixture.sessionPath, "utf8")).toBe(sourceJsonl);
    } finally {
      await Promise.all([sourceRuntime.dispose(), targetRuntime.dispose()]);
    }
  }, 15_000);

  it("does not leave a target Session file for an invalid source entry", async () => {
    const fixture = await createForkFixture();
    const runtime = new PiSdkRuntime();
    try {
      await runtime.initialize({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        trust: "unknown",
        approvalMode: "guided"
      });
      const sessionDirectory = join(fixture.agentDir, "sessions");
      const filesBefore = await readdir(sessionDirectory);

      await expect(runtime.forkSessionFrom(
        fixture.sessionPath,
        "missing-entry"
      )).rejects.toThrow();

      expect(await readdir(sessionDirectory)).toEqual(filesBefore);
    } finally {
      await runtime.dispose();
    }
  }, 15_000);

  it("removes the copied Session when an extension cancels the target switch", async () => {
    const fixture = await createForkFixture();
    const extensionsDirectory = join(fixture.agentDir, "extensions");
    await mkdir(extensionsDirectory, { recursive: true });
    await writeFile(join(extensionsDirectory, "cancel-switch.ts"), `
      export default function cancelSwitch(pi) {
        pi.on("session_before_switch", async (event) => (
          event.reason === "resume" ? { cancel: true } : undefined
        ));
      }
    `, "utf8");
    const runtime = new PiSdkRuntime();
    try {
      await runtime.initialize({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        trust: "unknown",
        approvalMode: "guided"
      });
      const sessionDirectory = join(fixture.agentDir, "sessions");
      const filesBefore = await readdir(sessionDirectory);

      await expect(runtime.forkSessionFrom(
        fixture.sessionPath,
        fixture.firstAssistantEntryId
      )).rejects.toThrow("cancelled the session fork");

      expect(await readdir(sessionDirectory)).toEqual(filesBefore);
    } finally {
      await runtime.dispose();
    }
  }, 15_000);
});

async function createForkFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-sdk-fork-"));
  temporaryDirectories.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const sessionDirectory = join(agentDir, "sessions");
  await Promise.all([
    mkdir(cwd),
    mkdir(sessionDirectory, { recursive: true })
  ]);

  const session = SessionManager.create(cwd, sessionDirectory);
  const firstUserEntryId = session.appendMessage({
    role: "user",
    content: "Fork this session.",
    timestamp: Date.now()
  });
  const firstAssistantEntryId = appendAssistant(session, "Fork source response.", Date.now() + 1);
  const secondUserEntryId = session.appendMessage({
    role: "user",
    content: "Edit this follow-up.",
    timestamp: Date.now() + 2
  });
  appendAssistant(session, "Second response.", Date.now() + 3);
  const sessionPath = session.getSessionFile();
  if (!sessionPath) throw new Error("Fork fixture must be persisted.");
  return {
    cwd,
    agentDir,
    sessionPath,
    firstUserEntryId,
    firstAssistantEntryId,
    secondUserEntryId
  };
}

function appendAssistant(session: SessionManager, text: string, timestamp: number): string {
  return session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "pi67-test",
    model: "fixture",
    usage: zeroUsage,
    stopReason: "stop",
    timestamp
  });
}
