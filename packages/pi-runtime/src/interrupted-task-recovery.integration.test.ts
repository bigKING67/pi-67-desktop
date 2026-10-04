import { readFile, writeFile } from "node:fs/promises";
import { createAgentSessionFromServices, SessionManager, VIRTUAL_MODEL_STATE_ENTRY, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { bindDesktopAutoRouting } from "./auto-routing.js";
import { createAutoRoutingFixture } from "./auto-routing.test-support.js";
import { continueInterruptedTask, inspectInterruptedTask, TASK_RECOVERY_MESSAGE_TYPE } from "./interrupted-task-recovery.js";

describe("interrupted task native continuation", () => {
  it("continues a reopened interrupted Auto turn on its persisted physical selection", async () => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "complex", candidateReplies: ["error"] });
    try {
      await fixture.session.prompt("Complete the synthetic recovery task");
      expect(fixture.session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
      const path = fixture.manager.getSessionFile();
      expect(path).toBeDefined();
      fixture.session.dispose();
      const manager = SessionManager.open(path!);
      const { session } = await createAgentSessionFromServices({ services: fixture.services, sessionManager: manager });
      try {
        await bindDesktopAutoRouting(session);
        fixture.setJudgeReply("standard");
        fixture.setCandidateReplies(["stop"]);
        const recovery = inspectInterruptedTask(session);
        expect(recovery.status).toBe("available");
        if (recovery.status !== "available") throw new Error("Expected recovery anchor.");
        await continueInterruptedTask(session, recovery.anchor);
        expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop", model: "complex" });
        expect(fixture.providerCalls).toEqual([
          { kind: "judge", model: "judge" },
          { kind: "candidate", model: "complex" },
          { kind: "candidate", model: "complex" }
        ]);
        expect(inspectInterruptedTask(session)).toEqual({ status: "none" });
        await expect(continueInterruptedTask(session, recovery.anchor)).rejects.toThrow("当前会话已变化");
        expect(fixture.providerCalls).toHaveLength(3);
        expect(manager.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === TASK_RECOVERY_MESSAGE_TYPE)).toHaveLength(1);
        await session.prompt("A separate synthetic standard task");
        expect(fixture.providerCalls.slice(3)).toEqual([{ kind: "judge", model: "judge" }, { kind: "candidate", model: "standard" }]);
      } finally { session.dispose(); }
    } finally { await fixture.dispose(); }
  });

  it.each(["before-response", "after-tool"] as const)("preserves Auto through a synthetic abrupt cutoff %s", async cutoff => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "complex", candidateReplies: cutoff === "after-tool" ? ["tool", "stop"] : ["stop"] });
    try {
      await fixture.session.prompt("Complete the synthetic interrupted task");
      const entries = fixture.manager.getBranch();
      const boundary = entries.findLast(entry => cutoff === "after-tool"
        ? entry.type === "message" && entry.message.role === "toolResult"
        : entry.type === "custom" && entry.customType === VIRTUAL_MODEL_STATE_ENTRY);
      if (!boundary) throw new Error("Missing persisted cutoff.");
      const manager = await reopenAt(fixture, boundary);
      const { session } = await createAgentSessionFromServices({ services: fixture.services, sessionManager: manager });
      try {
        await bindDesktopAutoRouting(session);
        fixture.setJudgeReply("standard");
        const previousCalls = fixture.providerCalls.length;
        const recovery = inspectInterruptedTask(session);
        if (recovery.status !== "available") throw new Error("Expected recoverable cutoff.");
        await continueInterruptedTask(session, recovery.anchor);
        expect(fixture.providerCalls.slice(previousCalls)).toEqual([{ kind: "candidate", model: "complex" }]);
        expect(session.messages.at(-1)).toMatchObject({ role: "assistant", model: "complex", stopReason: "stop" });
        expect(manager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user")).toHaveLength(1);
      } finally { session.dispose(); }
    } finally { await fixture.dispose(); }
  });

  it.each(["unconfirmed-tool", "no-current-route"] as const)("denies continuation before dispatch for %s", async cutoff => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "complex", candidateReplies: ["tool", "stop"] });
    try {
      await fixture.session.prompt("Complete the synthetic interrupted task");
      const boundary = fixture.manager.getBranch().findLast(entry => entry.type === "message"
        && (cutoff === "unconfirmed-tool" ? entry.message.role === "assistant" && entry.message.stopReason === "toolUse" : entry.message.role === "user"));
      if (!boundary) throw new Error("Missing persisted cutoff.");
      const manager = await reopenAt(fixture, boundary);
      const { session } = await createAgentSessionFromServices({ services: fixture.services, sessionManager: manager });
      try {
        await bindDesktopAutoRouting(session);
        const calls = fixture.providerCalls.length;
        expect(inspectInterruptedTask(session)).toMatchObject({ status: "blocked", reason: cutoff === "unconfirmed-tool" ? "unconfirmed-tools" : "auto-selection-missing" });
        await expect(continueInterruptedTask(session, manager.getLeafId()!)).rejects.toThrow("当前会话已变化");
        expect(fixture.providerCalls).toHaveLength(calls);
      } finally { session.dispose(); }
    } finally { await fixture.dispose(); }
  });
});

async function reopenAt(fixture: Awaited<ReturnType<typeof createAutoRoutingFixture>>, boundary: SessionEntry) {
  const path = fixture.manager.getSessionFile()!;
  fixture.session.dispose();
  const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
  const index = lines.findIndex(line => (JSON.parse(line) as { id?: string }).id === boundary.id);
  if (index < 1) throw new Error("Missing recorded branch entry.");
  // A disposable synthetic fixture cut at a real persisted entry; not a live process crash.
  await writeFile(path, `${lines.slice(0, index + 1).join("\n")}\n`);
  return SessionManager.open(path);
}
