import { describe, expect, it } from "vitest";
import type { AgentCommand } from "@pi67/protocol";
import { CommandScheduler, commandClassFor } from "./command-scheduler.js";

describe("CommandScheduler", () => {
  it("classifies control, recovery, turn, queue, interrupt and query commands", () => {
    expect(commandClassFor(command("session.open", { path: "/tmp/s.jsonl" }))).toBe("exclusive-control");
    expect(commandClassFor(command("session.fork", { entryId: "entry-1" }))).toBe("exclusive-control");
    expect(commandClassFor(command("prompt.submit", { submissionId: "s", text: "go", delivery: "new-turn" })))
      .toBe("turn");
    expect(commandClassFor(command("prompt.submit", { submissionId: "s", text: "adjust", delivery: "steer" })))
      .toBe("queue");
    expect(commandClassFor(command("operation.abort", {}))).toBe("interrupt");
    expect(commandClassFor(command("queue.clear", {}))).toBe("interrupt");
    expect(commandClassFor(command("approval.respond", {
      requestId: "approval-1", toolCallId: "tool-call-1", sessionId: "session-1",
      sessionGeneration: 1, operationId: "operation-1", decision: "deny"
    }))).toBe("interrupt");
    expect(commandClassFor(command("task.toolMode.set", { mode: "yolo" }))).toBe("interrupt");
    expect(commandClassFor(command("runtime.getStatus", {}))).toBe("query");
    expect(commandClassFor(command("extension.catalog.list", {}))).toBe("query");
    expect(commandClassFor(command("subagent.list", {}))).toBe("query");
    expect(commandClassFor(command("subagent.wait", { ids: ["run-1"] }))).toBe("query");
    expect(commandClassFor(command("subagent.steer", { id: "run-1", text: "adjust" }))).toBe("interrupt");
    expect(commandClassFor(command("subagent.stop", { id: "run-1" }))).toBe("interrupt");
    expect(commandClassFor(command("subagent.resume", { id: "run-1" }))).toBe("interrupt");
    expect(commandClassFor(command("projection.resync", {}))).toBe("recovery");
    expect(commandClassFor(command("workspace.changes", {}))).toBe("query");
    expect(commandClassFor(command("session.tree", {}))).toBe("query");
    expect(commandClassFor(command("asset.read", {
      assetId: "asset-1", sessionGeneration: 1, offset: 0, length: 1_024
    }))).toBe("query");
  });

  it("rejects queued prompts when the active operation is not a Pi turn", async () => {
    const scheduler = new CommandScheduler(() => true, () => false);
    await expect(scheduler.run(command("prompt.steer", { text: "adjust" }), async () => "queued"))
      .rejects.toMatchObject({ code: "BUSY" });
  });

  it("runs queued prompts in strict FIFO order", async () => {
    const scheduler = new CommandScheduler(() => true);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = scheduler.run(command("prompt.submit", {
      submissionId: "submission-1", text: "first", delivery: "follow-up"
    }), async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push("first:end");
      return "first";
    });
    const second = scheduler.run(command("prompt.submit", {
      submissionId: "submission-2", text: "second", delivery: "steer"
    }), async () => {
      order.push("second");
      return "second";
    });
    const third = scheduler.run(command("prompt.followUp", { text: "third" }), async () => {
      order.push("third");
      return "third";
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await expect(Promise.all([first, second, third])).resolves.toEqual(["first", "second", "third"]);
    expect(order).toEqual(["first:start", "first:end", "second", "third"]);
  });

  it("continues the queue lane after an earlier queued prompt rejects", async () => {
    const scheduler = new CommandScheduler(() => true);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = scheduler.run(command("prompt.steer", { text: "first" }), async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push("first:reject");
      throw new Error("queue failed");
    });
    const second = scheduler.run(command("prompt.followUp", { text: "second" }), async () => {
      order.push("second");
      return "continued";
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await expect(first).rejects.toThrow("queue failed");
    await expect(second).resolves.toBe("continued");
    expect(order).toEqual(["first:start", "first:reject", "second"]);
  });

  it("does not block interrupt commands behind the queue lane", async () => {
    const scheduler = new CommandScheduler(() => true);
    const order: string[] = [];
    let releaseQueue!: () => void;
    const queued = scheduler.run(command("prompt.steer", { text: "adjust" }), async () => {
      order.push("queue:start");
      await new Promise<void>((resolve) => { releaseQueue = resolve; });
      order.push("queue:end");
    });
    await Promise.resolve();

    await expect(scheduler.run(command("operation.abort", {}), async () => {
      order.push("interrupt");
      return "aborted";
    })).resolves.toBe("aborted");
    expect(order).toEqual(["queue:start", "interrupt"]);

    releaseQueue();
    await queued;
    expect(order).toEqual(["queue:start", "interrupt", "queue:end"]);
  });

  it("allows extension catalog queries while a turn is active", async () => {
    const scheduler = new CommandScheduler(() => true);
    await expect(scheduler.run(command("extension.catalog.list", {}), async () => "catalog"))
      .resolves.toBe("catalog");
  });

  it("keeps child wait and control lanes available while a parent turn is active", async () => {
    const scheduler = new CommandScheduler(() => true);
    let releaseWait!: () => void;
    const waiting = scheduler.run(command("subagent.wait", { ids: ["run-1"] }), () => (
      new Promise<string>((resolve) => { releaseWait = () => resolve("settled"); })
    ));
    await Promise.resolve();

    await expect(scheduler.run(command("subagent.stop", { id: "run-1" }), async () => "stopped"))
      .resolves.toBe("stopped");
    releaseWait();
    await expect(waiting).resolves.toBe("settled");
  });

  it("serializes exclusive commands", async () => {
    const scheduler = new CommandScheduler(() => false);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = scheduler.run(command("session.open", { path: "/tmp/a.jsonl" }), async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push("first:end");
    });
    const second = scheduler.run(command("session.create", { creationId: "session-creation-second" }), async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("runs projection recovery after an admitted transition without rejecting it as busy", async () => {
    const scheduler = new CommandScheduler(() => false);
    const order: string[] = [];
    let releaseTransition!: () => void;
    const transition = scheduler.run(command("session.open", { path: "/tmp/a.jsonl" }), async () => {
      order.push("transition:start");
      await new Promise<void>((resolve) => { releaseTransition = resolve; });
      order.push("transition:end");
    });
    await Promise.resolve();
    const recovery = scheduler.run(command("projection.resync", {}), async () => {
      order.push("recovery");
      return "resynced";
    });
    await Promise.resolve();
    expect(order).toEqual(["transition:start"]);

    releaseTransition();
    await expect(recovery).resolves.toBe("resynced");
    await transition;
    expect(order).toEqual(["transition:start", "transition:end", "recovery"]);
  });

  it("defers projection queries until an admitted transition settles", async () => {
    const scheduler = new CommandScheduler(() => false);
    const order: string[] = [];
    let releaseTransition!: () => void;
    const transition = scheduler.run(command("resource.reload", {}), async () => {
      order.push("transition:start");
      await new Promise<void>((resolve) => { releaseTransition = resolve; });
      order.push("transition:end");
    });
    await Promise.resolve();

    const projectionQueries: AgentCommand[] = [
      command("workspace.changes", {}),
      command("session.catalog.query", { scope: "workspace", limit: 50 }),
      command("session.tree", {}),
      command("message.page", { direction: "newer" })
    ];
    const queries = projectionQueries.map((projectionQuery) => (
      scheduler.run(projectionQuery, async () => {
        order.push(projectionQuery.type);
        return projectionQuery.type;
      })
    ));
    await Promise.resolve();
    expect(order).toEqual(["transition:start"]);
    releaseTransition();
    await expect(Promise.all([transition, ...queries])).resolves.toEqual([
      undefined,
      "workspace.changes",
      "session.catalog.query",
      "session.tree",
      "message.page"
    ]);
    expect(order).toEqual([
      "transition:start",
      "transition:end",
      "workspace.changes",
      "session.catalog.query",
      "session.tree",
      "message.page"
    ]);
  });

  it("runs a deferred projection query after the preceding transition fails", async () => {
    const scheduler = new CommandScheduler(() => false);
    let rejectTransition!: (error: Error) => void;
    const transition = scheduler.run(command("resource.reload", {}), () => (
      new Promise<void>((_resolve, reject) => { rejectTransition = reject; })
    ));
    await Promise.resolve();
    const tree = scheduler.run(command("session.tree", {}), async () => "tree-after-failure");
    const transitionFailure = expect(transition).rejects.toThrow("reload failed");
    rejectTransition(new Error("reload failed"));
    await transitionFailure;
    await expect(tree).resolves.toBe("tree-after-failure");
  });

  it("drops a deferred projection query during shutdown", async () => {
    const scheduler = new CommandScheduler(() => false);
    let releaseTransition!: () => void;
    let queryExecuted = false;
    const transition = scheduler.run(command("resource.reload", {}), () => (
      new Promise<void>((resolve) => { releaseTransition = resolve; })
    ));
    await Promise.resolve();
    const tree = scheduler.run(command("session.tree", {}), async () => {
      queryExecuted = true;
      return "tree";
    });
    expect(scheduler.shutdown()).toEqual({ queuedCommandsDropped: 1 });
    const treeRejected = expect(tree).rejects.toMatchObject({
      code: "CONNECTION_CLOSED",
      details: { shuttingDown: true }
    });
    releaseTransition();
    await transition;
    await treeRejected;
    expect(queryExecuted).toBe(false);
  });

  it("keeps non-projection queries fail-fast during a transition", async () => {
    const scheduler = new CommandScheduler(() => false);
    let releaseTransition!: () => void;
    const transition = scheduler.run(command("resource.reload", {}), () => (
      new Promise<void>((resolve) => { releaseTransition = resolve; })
    ));
    await Promise.resolve();

    await expect(scheduler.run(command("doctor.run", {}), async () => "doctor"))
      .rejects.toMatchObject({ code: "BUSY", message: "A session transition is in progress." });
    releaseTransition();
    await transition;
  });

  it("allows projection recovery to capture an active turn", async () => {
    const scheduler = new CommandScheduler(() => true);
    await expect(scheduler.run(command("projection.resync", {}), async () => "active projection"))
      .resolves.toBe("active projection");
  });

  it("rejects turns during control work and queue commands without an active turn", async () => {
    let release!: () => void;
    let active = false;
    const scheduler = new CommandScheduler(() => active);
    const control = scheduler.run(command("session.open", { path: "/tmp/a.jsonl" }), () => (
      new Promise<void>((resolve) => { release = resolve; })
    ));
    await Promise.resolve();
    await expect(scheduler.run(command("prompt.submit", {
      submissionId: "s", text: "go", delivery: "new-turn"
    }), async () => undefined)).rejects.toMatchObject({ code: "BUSY" });
    await expect(scheduler.run(command("prompt.steer", { text: "adjust" }), async () => undefined))
      .rejects.toMatchObject({ code: "BUSY" });
    active = true;
    await expect(scheduler.run(command("prompt.steer", { text: "adjust" }), async () => "queued"))
      .resolves.toBe("queued");
    release();
    await control;
  });

  it("bounds concurrent queries and releases capacity after success or failure", async () => {
    const scheduler = new CommandScheduler(() => false, undefined, { maxConcurrentQueries: 2 });
    const releases: Array<() => void> = [];
    const query = () => scheduler.run(command("session.catalog.query", { scope: "workspace", limit: 50 }), () => (
      new Promise<void>((resolve) => releases.push(resolve))
    ));
    const first = query();
    const second = query();
    await Promise.resolve();

    await expect(query()).rejects.toMatchObject({ code: "BUSY" });
    releases.shift()?.();
    await first;
    await expect(scheduler.run(command("session.catalog.query", { scope: "workspace", limit: 50 }), async () => {
      throw new Error("query failed");
    })).rejects.toThrow("query failed");
    releases.shift()?.();
    await second;
    await expect(scheduler.run(command("session.catalog.query", { scope: "workspace", limit: 50 }), async () => "available"))
      .resolves.toBe("available");
  });

  it("bounds admitted queue commands and releases capacity after settlement", async () => {
    const scheduler = new CommandScheduler(() => true, undefined, { maxQueuedCommands: 2 });
    let releaseFirst!: () => void;
    const first = scheduler.run(command("prompt.steer", { text: "first" }), () => (
      new Promise<void>((resolve) => { releaseFirst = resolve; })
    ));
    const second = scheduler.run(command("prompt.followUp", { text: "second" }), async () => undefined);
    await Promise.resolve();

    await expect(scheduler.run(command("prompt.steer", { text: "overflow" }), async () => undefined))
      .rejects.toMatchObject({
        code: "RESOURCE_LIMIT_EXCEEDED",
        details: { maxQueuedCommands: 2 }
      });

    releaseFirst();
    await Promise.all([first, second]);
    await expect(scheduler.run(command("prompt.followUp", { text: "available" }), async () => "accepted"))
      .resolves.toBe("accepted");

    const rejecting = scheduler.run(command("prompt.steer", { text: "rejecting" }), async () => {
      throw new Error("delivery failed");
    });
    await expect(rejecting).rejects.toThrow("delivery failed");
    await expect(scheduler.run(command("prompt.followUp", { text: "after failure" }), async () => "accepted"))
      .resolves.toBe("accepted");
  });

  it("clears pending queue work through an ordered barrier", async () => {
    const scheduler = new CommandScheduler(() => true, undefined, { maxQueuedCommands: 3 });
    const order: string[] = [];
    let releaseRunning!: () => void;
    const running = scheduler.run(command("prompt.steer", { text: "running" }), async () => {
      order.push("running:start");
      await new Promise<void>((resolve) => { releaseRunning = resolve; });
      order.push("running:end");
      return "running";
    });
    const pending = scheduler.run(command("prompt.followUp", { text: "pending" }), async () => {
      order.push("pending");
      return "pending";
    });
    await Promise.resolve();

    const cleared = scheduler.clearQueue(async () => {
      order.push("clear");
      return "cleared";
    });
    const afterClear = scheduler.run(command("prompt.steer", { text: "after clear" }), async () => {
      order.push("after-clear");
      return "after-clear";
    });
    expect(order).toEqual(["running:start"]);

    releaseRunning();
    await expect(running).resolves.toBe("running");
    await expect(pending).rejects.toMatchObject({
      code: "STALE_OPERATION",
      details: { queueCleared: true }
    });
    await expect(cleared).resolves.toEqual({ pendingCount: 1, result: "cleared" });
    await expect(afterClear).resolves.toBe("after-clear");
    expect(order).toEqual(["running:start", "running:end", "clear", "after-clear"]);
  });

  it("rejects invalid concurrency and queue admission limits", () => {
    expect(() => new CommandScheduler(() => false, undefined, { maxConcurrentQueries: 0 }))
      .toThrow("maxConcurrentQueries must be a positive integer.");
    expect(() => new CommandScheduler(() => false, undefined, { maxQueuedCommands: 1.5 }))
      .toThrow("maxQueuedCommands must be a positive integer.");
  });

  it("waits for admitted state queries before starting an exclusive transition", async () => {
    const scheduler = new CommandScheduler(() => false);
    const order: string[] = [];
    let releaseQuery!: () => void;
    const query = scheduler.run(command("session.catalog.query", { scope: "workspace", limit: 50 }), async () => {
      order.push("query:start");
      await new Promise<void>((resolve) => { releaseQuery = resolve; });
      order.push("query:end");
    });
    await Promise.resolve();
    const transition = scheduler.run(command("session.open", { path: "/tmp/a.jsonl" }), async () => {
      order.push("transition");
    });
    await Promise.resolve();
    expect(order).toEqual(["query:start"]);
    releaseQuery();
    await Promise.all([query, transition]);
    expect(order).toEqual(["query:start", "query:end", "transition"]);
  });

  it("keeps lightweight runtime status available during a transition", async () => {
    const scheduler = new CommandScheduler(() => false);
    let releaseTransition!: () => void;
    const transition = scheduler.run(command("session.open", { path: "/tmp/a.jsonl" }), () => (
      new Promise<void>((resolve) => { releaseTransition = resolve; })
    ));
    await Promise.resolve();
    await expect(scheduler.run(command("runtime.getStatus", {}), async () => "ready"))
      .resolves.toBe("ready");
    releaseTransition();
    await transition;
  });

  it("closes admission and invalidates queued work during shutdown", async () => {
    const scheduler = new CommandScheduler(() => false, () => true);
    const executed: string[] = [];
    let releaseExclusive!: () => void;
    let releaseQueue!: () => void;
    const runningExclusive = scheduler.run(command("session.open", { path: "/tmp/a.jsonl" }), async () => {
      executed.push("exclusive:running");
      await new Promise<void>((resolve) => { releaseExclusive = resolve; });
    });
    const queuedExclusive = scheduler.run(command("session.create", { creationId: "session-creation-queued" }), async () => {
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

function command<T extends AgentCommand["type"]>(type: T, payload: Extract<AgentCommand, { type: T }>["payload"]): AgentCommand {
  return { type, payload } as AgentCommand;
}
