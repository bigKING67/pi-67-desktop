import { describe, expect, it } from "vitest";
import type { AgentCommand } from "@pi67/protocol";
import { CommandScheduler } from "./command-scheduler.js";

describe("CommandScheduler shutdown", () => {
  it("closes admission and invalidates queued work during shutdown", async () => {
    const scheduler = new CommandScheduler(() => false, () => true);
    const executed: string[] = [];
    let releaseExclusive!: () => void;
    let releaseQueue!: () => void;
    const runningExclusive = scheduler.run(command("session.open", { path: "/tmp/a.jsonl" }), async () => {
      executed.push("exclusive:running");
      await new Promise<void>((resolve) => { releaseExclusive = resolve; });
    });
    const queuedExclusive = scheduler.run(command("session.create", {
      creationId: "session-creation-queued"
    }), async () => {
      executed.push("exclusive:dropped");
    });
    const runningQueue = scheduler.run(command("prompt.steer", { text: "running" }), async () => {
      executed.push("queue:running");
      await new Promise<void>((resolve) => { releaseQueue = resolve; });
    });
    const queuedPrompt = scheduler.run(command("prompt.followUp", { text: "dropped" }), async () => {
      executed.push("queue:dropped");
    });
    await Promise.resolve();

    expect(scheduler.diagnostics()).toEqual({
      queryActive: 0,
      controlQueued: 1,
      controlRunning: true,
      promptQueued: 1,
      promptRunning: true,
      turnAdmission: false,
      closed: false
    });

    expect(scheduler.shutdown()).toEqual({ queuedCommandsDropped: 2 });
    expect(scheduler.diagnostics()).toMatchObject({ closed: true, controlQueued: 1, promptQueued: 1 });
    expect(scheduler.shutdown()).toEqual({ queuedCommandsDropped: 2 });
    await expect(scheduler.run(command("runtime.getStatus", {}), async () => "late"))
      .rejects.toMatchObject({ code: "CONNECTION_CLOSED", details: { shuttingDown: true } });
    await expect(scheduler.clearQueue(async () => "late"))
      .rejects.toMatchObject({ code: "CONNECTION_CLOSED" });

    const queuedExclusiveRejected = expect(queuedExclusive).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    const queuedPromptRejected = expect(queuedPrompt).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    releaseExclusive();
    releaseQueue();
    await Promise.all([runningExclusive, runningQueue]);
    await queuedExclusiveRejected;
    await queuedPromptRejected;
    expect(executed).toEqual(["exclusive:running", "queue:running"]);
  });
});

function command<T extends AgentCommand["type"]>(
  type: T,
  payload: Extract<AgentCommand, { type: T }>["payload"]
): AgentCommand {
  return { type, payload } as AgentCommand;
}
