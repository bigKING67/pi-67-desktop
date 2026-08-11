import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { NativeSubagentView } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import { NativeSubagentAdmission } from "./native-subagent-admission.js";
import {
  NativeSubagentCoordinator,
  SUBAGENT_LIFECYCLE_ENTRY_TYPE,
  SUBAGENT_SESSION_ENTRY_TYPE
} from "./native-subagent-coordinator.js";

describe("NativeSubagentCoordinator", () => {
  it("persists an independent child Pi JSONL and terminal result", async () => {
    const fixture = await coordinatorFixture("complete");
    await fixture.coordinator.bindParent(fixture.parent);
    const spawned = await fixture.coordinator.spawn({
      task: "Inspect the bounded module.",
      role: "explorer",
      mode: "background"
    });
    const waited = await fixture.coordinator.wait([spawned.runId], "all", 1_000);

    expect(waited.timedOut).toBe(false);
    expect(waited.items[0]).toMatchObject({
      runId: spawned.runId,
      childId: spawned.childId,
      state: "completed",
      result: "child result"
    });
    expect(waited.items[0]?.sessionPath).toContain("desktop-subagents");
    const parentEntries = fixture.parent.sessionManager.getBranch();
    expect(parentEntries.some((entry) => entry.type === "custom" && entry.customType === SUBAGENT_SESSION_ENTRY_TYPE))
      .toBe(true);
    expect(parentEntries.some((entry) => entry.type === "custom" && entry.customType === SUBAGENT_LIFECYCLE_ENTRY_TYPE))
      .toBe(true);
    expect(fixture.admission.snapshot().global).toBe(0);
  });

  it("rehydrates nonterminal roster entries as interrupted after Host restart", async () => {
    const fixture = await coordinatorFixture("pending");
    const view: NativeSubagentView = {
      runId: "run-recovery",
      childId: "child-recovery",
      activationId: "activation-recovery",
      depth: 1,
      role: "worker",
      state: "running",
      mode: "background",
      context: "fresh",
      isolation: "shared",
      sessionPath: join(fixture.agentDir, "child.jsonl"),
      updatedAt: 1
    };
    fixture.parent.sessionManager.appendCustomEntry(SUBAGENT_SESSION_ENTRY_TYPE, view);
    await fixture.coordinator.bindParent(fixture.parent);

    expect(fixture.coordinator.status("run-recovery")).toMatchObject({
      state: "interrupted",
      error: expect.stringContaining("Agent Host restarted")
    });
    expect(fixture.emit).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-recovery", state: "interrupted" }),
      "interrupted"
    );
  });

  it("fails closed instead of creating a second Worktree mutation runtime", async () => {
    const fixture = await coordinatorFixture("complete");
    await fixture.coordinator.bindParent(fixture.parent);
    await expect(fixture.coordinator.spawn({
      task: "edit",
      isolation: "worktree"
    })).rejects.toMatchObject({
      code: "UNSUPPORTED",
      details: { feature: "native-subagent-worktree" }
    });
  });

  it("does not let a previous activation settle or dispose a resumed child", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-native-subagent-activation-"));
    const agentDir = join(root, "agent");
    const parentManager = SessionManager.create(root, join(root, "parent"), { id: "parent-session" });
    parentManager.appendCustomEntry("fixture", {});
    const parent = fakeParent(parentManager);
    const admission = new NativeSubagentAdmission();
    const firstPrompt = deferred<void>();
    const secondPrompt = deferred<void>();
    const firstDispose = vi.fn(async () => undefined);
    const secondDispose = vi.fn(async () => undefined);
    let created = 0;
    let sequence = 0;
    const coordinator = new NativeSubagentCoordinator({
      admission,
      parentKey: "parent-task",
      getAgentDir: () => agentDir,
      createId: () => `identity-${++sequence}`,
      emit: vi.fn(),
      createSession: async ({ sessionManager }) => {
        created += 1;
        return created === 1
          ? { session: controlledChild(sessionManager, firstPrompt.promise), dispose: firstDispose }
          : { session: controlledChild(sessionManager, secondPrompt.promise), dispose: secondDispose };
      }
    });
    await coordinator.bindParent(parent);
    const spawned = await coordinator.spawn({ task: "Keep running", mode: "background" });
    await coordinator.stop(spawned.runId);
    const resumed = await coordinator.resume(spawned.runId, "background");

    firstPrompt.reject(new Error("late failure from the previous activation"));
    await Promise.resolve();
    await Promise.resolve();

    expect(coordinator.status(spawned.runId)).toMatchObject({
      activationId: resumed.activationId,
      state: "running"
    });
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).not.toHaveBeenCalled();
    expect(admission.snapshot().global).toBe(1);

    await coordinator.stop(spawned.runId);
    expect(secondDispose).toHaveBeenCalledTimes(1);
    expect(admission.snapshot().global).toBe(0);
  });

  it("disposes a child session created after its parent binding changed", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-native-subagent-parent-race-"));
    const agentDir = join(root, "agent");
    const firstManager = SessionManager.create(root, join(root, "parent-a"), { id: "parent-a" });
    const secondManager = SessionManager.create(root, join(root, "parent-b"), { id: "parent-b" });
    firstManager.appendCustomEntry("fixture", {});
    secondManager.appendCustomEntry("fixture", {});
    const createStarted = deferred<void>();
    const releaseCreate = deferred<void>();
    const dispose = vi.fn(async () => undefined);
    let sequence = 0;
    const coordinator = new NativeSubagentCoordinator({
      admission: new NativeSubagentAdmission(),
      parentKey: "parent-task",
      getAgentDir: () => agentDir,
      createId: () => `identity-${++sequence}`,
      emit: vi.fn(),
      createSession: async ({ sessionManager }) => {
        createStarted.resolve();
        await releaseCreate.promise;
        return { session: controlledChild(sessionManager, new Promise<void>(() => undefined)), dispose };
      }
    });
    await coordinator.bindParent(fakeParent(firstManager));
    const spawning = coordinator.spawn({ task: "Race the parent transition", mode: "background" });
    await createStarted.promise;
    await coordinator.bindParent(fakeParent(secondManager));
    releaseCreate.resolve();

    await expect(spawning).rejects.toMatchObject({ code: "SESSION_CHANGED_EXTERNALLY" });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(coordinator.list()).toEqual([]);
    expect(secondManager.getBranch().some((entry) => (
      entry.type === "custom" && entry.customType === SUBAGENT_LIFECYCLE_ENTRY_TYPE
    ))).toBe(false);
  });
});

async function coordinatorFixture(mode: "complete" | "pending") {
  const root = await mkdtemp(join(tmpdir(), "pi67-native-subagent-"));
  const agentDir = join(root, "agent");
  const parentManager = SessionManager.create(root, join(root, "parent"), { id: "parent-session" });
  parentManager.appendCustomEntry("fixture", {});
  const parent = fakeParent(parentManager);
  const admission = new NativeSubagentAdmission();
  const emit = vi.fn();
  let sequence = 0;
  const coordinator = new NativeSubagentCoordinator({
    admission,
    parentKey: "parent-task",
    getAgentDir: () => agentDir,
    createId: () => `identity-${++sequence}`,
    emit,
    createSession: async ({ sessionManager }) => {
      const session = fakeChild(sessionManager, mode);
      return { session, dispose: async () => undefined };
    }
  });
  return { coordinator, admission, emit, parent, agentDir };
}

function fakeParent(sessionManager: SessionManager): AgentSession {
  return {
    sessionId: sessionManager.getSessionId(),
    sessionFile: sessionManager.getSessionFile(),
    sessionManager,
    model: { provider: "groland", id: "gpt-5.6" },
    thinkingLevel: "high",
    isStreaming: false
  } as unknown as AgentSession;
}

function fakeChild(sessionManager: SessionManager, mode: "complete" | "pending"): AgentSession {
  const messages: Array<Record<string, unknown>> = [];
  return {
    sessionId: sessionManager.getSessionId(),
    sessionFile: sessionManager.getSessionFile(),
    sessionManager,
    model: { provider: "groland", id: "gpt-5.6" },
    thinkingLevel: "high",
    isStreaming: false,
    messages,
    subscribe: () => () => undefined,
    steer: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    prompt: vi.fn(async () => {
      if (mode === "pending") return new Promise<void>(() => undefined);
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: "child result" }],
        usage: {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0.01 }
        }
      });
    })
  } as unknown as AgentSession;
}

function controlledChild(sessionManager: SessionManager, prompt: Promise<void>): AgentSession {
  return {
    sessionId: sessionManager.getSessionId(),
    sessionFile: sessionManager.getSessionFile(),
    sessionManager,
    model: { provider: "groland", id: "gpt-5.6" },
    thinkingLevel: "high",
    isStreaming: true,
    messages: [],
    subscribe: () => () => undefined,
    steer: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    prompt: vi.fn(() => prompt)
  } as unknown as AgentSession;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
