import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isEventEnvelope } from "@pi67/protocol";
import {
  FakePort,
  attach,
  command,
  createServerFixture,
  initialize,
  submit,
  task
} from "./host-server-multi-task-fixture.js";

describe("AgentHostServer multi-Task routing", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("creates independent Task runtimes while sharing Workspace services and Host credentials", async () => {
    const fixture = await createServerFixture(3);
    const workspaceA = await fixture.workspace("workspace-a");
    const workspaceB = await fixture.workspace("workspace-b");
    temporaryRoots.push(workspaceA.root, workspaceB.root);
    const taskA = task("workspace-a", "task-a");
    const taskB = task("workspace-a", "task-b");
    const taskC = task("workspace-b", "task-c");

    expect((await initialize(fixture.port, taskA, workspaceA)).response).toMatchObject({ ok: true });
    expect((await initialize(fixture.port, taskB, workspaceA)).response).toMatchObject({ ok: true });
    expect((await initialize(fixture.port, taskC, workspaceB)).response).toMatchObject({ ok: true });

    expect(fixture.loader).toHaveBeenCalledTimes(3);
    expect(fixture.runtimes.map((runtime) => runtime.id)).toEqual(["1", "2", "3"]);
    expect(fixture.options[0]?.workspaceServices).toBe(fixture.options[1]?.workspaceServices);
    expect(fixture.options[0]?.workspaceServices).not.toBe(fixture.options[2]?.workspaceServices);
    const credentialStore = fixture.options[0]?.runtimeCredentialOverrides;
    expect(credentialStore).toBeDefined();
    expect(fixture.options.every((options) => options.runtimeCredentialOverrides === credentialStore)).toBe(true);

    await fixture.server.shutdown();
  });

  it("keeps background Task runtimes alive when the Renderer connection is replaced", async () => {
    const fixture = await createServerFixture(2);
    const workspace = await fixture.workspace("workspace-a");
    temporaryRoots.push(workspace.root);
    const taskA = task("workspace-a", "task-a");
    const taskB = task("workspace-a", "task-b");
    await initialize(fixture.port, taskA, workspace);
    await initialize(fixture.port, taskB, workspace);

    const replacement = new FakePort();
    await attach(fixture.server, replacement);
    expect(fixture.port.close).toHaveBeenCalledOnce();
    expect(fixture.runtimes[0]?.dispose).not.toHaveBeenCalled();
    expect(fixture.runtimes[1]?.dispose).not.toHaveBeenCalled();
    expect(fixture.runtimes[0]?.cancelInteractiveRequests).toHaveBeenCalledWith("connection-close");
    expect(fixture.runtimes[1]?.cancelInteractiveRequests).toHaveBeenCalledWith("connection-close");
    expect(fixture.sdkVersionLoader).toHaveBeenCalledOnce();

    expect((await command(replacement, taskA, "session.tree", {})).response).toMatchObject({ ok: true });
    expect((await command(replacement, taskB, "session.tree", {})).response).toMatchObject({ ok: true });
    expect(fixture.loader).toHaveBeenCalledTimes(2);

    await fixture.server.shutdown();
  });

  it("does not create an unbound Task Runtime while probing a missing projection", async () => {
    const fixture = await createServerFixture(1);
    const workspace = await fixture.workspace("workspace-a");
    temporaryRoots.push(workspace.root);
    const taskA = task("workspace-a", "task-a");

    expect((await command(fixture.port, taskA, "projection.resync", {})).response).toMatchObject({
      ok: false,
      error: { code: "RUNTIME_NOT_READY" }
    });
    expect(fixture.loader).not.toHaveBeenCalled();

    expect((await initialize(fixture.port, taskA, workspace)).response).toMatchObject({ ok: true });
    expect(fixture.loader).toHaveBeenCalledOnce();
    expect(fixture.options[0]?.workspaceServices).toBeDefined();

    await fixture.server.shutdown();
  });

  it("closes only the addressed Task and replays the close acknowledgement", async () => {
    const fixture = await createServerFixture(2);
    const workspace = await fixture.workspace("workspace-a");
    temporaryRoots.push(workspace.root);
    const taskA = task("workspace-a", "task-a");
    const taskB = task("workspace-a", "task-b");
    await initialize(fixture.port, taskA, workspace);
    await initialize(fixture.port, taskB, workspace);

    const firstClose = await command(
      fixture.port,
      taskA,
      "task.close",
      { mode: "dispose" },
      "close-task-a"
    );
    expect(firstClose.response).toMatchObject({
      ok: true,
      result: { closed: true, stopped: false }
    });
    expect(fixture.runtimes[0]?.dispose).toHaveBeenCalledOnce();
    expect(fixture.runtimes[1]?.dispose).not.toHaveBeenCalled();

    expect((await command(fixture.port, taskB, "session.tree", {})).response).toMatchObject({ ok: true });
    expect((await command(fixture.port, taskA, "session.tree", {})).response).toMatchObject({
      ok: false,
      error: { code: "RUNTIME_NOT_READY" }
    });
    const replay = await command(
      fixture.port,
      taskA,
      "task.close",
      { mode: "dispose" },
      "close-task-a"
    );
    expect(replay.response).toMatchObject(firstClose.response.ok
      ? { ok: true, result: firstClose.response.result }
      : { ok: false });
    expect(fixture.runtimes[0]?.dispose).toHaveBeenCalledOnce();

    await fixture.server.shutdown();
  });

  it("stops an active Task without disturbing another Task", async () => {
    const fixture = await createServerFixture(2);
    const workspace = await fixture.workspace("workspace-a");
    temporaryRoots.push(workspace.root);
    const taskA = task("workspace-a", "task-a");
    const taskB = task("workspace-a", "task-b");
    await initialize(fixture.port, taskA, workspace);
    await initialize(fixture.port, taskB, workspace);

    expect((await submit(fixture.port, taskA, "run-task-a")).response).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(fixture.runtimes[0]?.submitPrompt).toHaveBeenCalledOnce());
    const close = await command(
      fixture.port,
      taskA,
      "task.close",
      { mode: "stop" },
      "stop-task-a"
    );
    expect(close.response).toMatchObject({
      ok: true,
      result: { closed: true, stopped: true }
    });
    expect(fixture.runtimes[0]?.abort).toHaveBeenCalledOnce();
    expect(fixture.runtimes[0]?.dispose).toHaveBeenCalledOnce();
    expect(fixture.runtimes[1]?.abort).not.toHaveBeenCalled();
    expect(fixture.runtimes[1]?.dispose).not.toHaveBeenCalled();
    expect((await command(fixture.port, taskB, "session.tree", {})).response).toMatchObject({ ok: true });

    await fixture.server.shutdown();
  });

  it("atomically rejects the fifth running Task and admits it after a slot is released", async () => {
    const fixture = await createServerFixture(5);
    const workspace = await fixture.workspace("workspace-a");
    temporaryRoots.push(workspace.root);
    const tasks = Array.from({ length: 5 }, (_, index) => task("workspace-a", `task-${index + 1}`));
    for (const context of tasks) await initialize(fixture.port, context, workspace);

    for (let index = 0; index < 4; index += 1) {
      expect((await submit(fixture.port, tasks[index]!, `run-${index + 1}`)).response)
        .toMatchObject({ ok: true });
    }
    const rejected = await submit(fixture.port, tasks[4]!, "run-5");
    expect(rejected.response).toMatchObject({
      ok: false,
      error: {
        code: "RESOURCE_LIMIT_EXCEEDED",
        details: { maximumRunningTasks: 4 }
      }
    });
    expect(fixture.runtimes[4]?.submitPrompt).not.toHaveBeenCalled();

    fixture.runtimes[0]?.completePrompt();
    await vi.waitFor(() => {
      expect(fixture.port.sent.some((value) => (
        isEventEnvelope(value)
        && value.type === "operation.completed"
        && value.context.scope === "task"
        && value.context.taskId === "task-1"
      ))).toBe(true);
    });
    expect((await submit(fixture.port, tasks[4]!, "run-5")).response).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(fixture.runtimes[4]?.submitPrompt).toHaveBeenCalledOnce());

    await fixture.server.shutdown();
  });

  it("prevents two Tasks from opening the same Pi Session writer", async () => {
    const fixture = await createServerFixture(2);
    const workspace = await fixture.workspace("workspace-a");
    temporaryRoots.push(workspace.root);
    const sharedSession = join(workspace.root, "shared-session.jsonl");
    const taskA = task("workspace-a", "task-a");
    const taskB = task("workspace-a", "task-b");

    expect((await initialize(fixture.port, taskA, workspace, sharedSession)).response)
      .toMatchObject({ ok: true });
    const conflict = await initialize(fixture.port, taskB, workspace, sharedSession);
    expect(conflict.response).toMatchObject({
      ok: false,
      error: {
        code: "BUSY",
        details: { sessionWriterLeaseConflict: true }
      }
    });
    expect(fixture.runtimes[1]?.initialize).not.toHaveBeenCalled();

    await command(fixture.port, taskA, "task.close", { mode: "dispose" }, "close-writer-a");
    expect((await initialize(fixture.port, taskB, workspace, sharedSession)).response)
      .toMatchObject({ ok: true });
    expect(fixture.runtimes[1]?.initialize).toHaveBeenCalledOnce();

    await fixture.server.shutdown();
  });

  it("fences a Task if an unknown session mutation discovers a writer conflict", async () => {
    const fixture = await createServerFixture(2);
    const workspace = await fixture.workspace("workspace-a");
    temporaryRoots.push(workspace.root);
    const sharedSession = join(workspace.root, "shared-session.jsonl");
    const taskA = task("workspace-a", "task-a");
    const taskB = task("workspace-a", "task-b");
    await initialize(fixture.port, taskA, workspace, sharedSession);
    await initialize(fixture.port, taskB, workspace);
    fixture.runtimes[1]?.useSessionPathForNextCreate(sharedSession);

    const conflict = await command(
      fixture.port,
      taskB,
      "session.create",
      {},
      "create-conflicting-writer"
    );
    expect(conflict.response).toMatchObject({
      ok: false,
      error: {
        code: "BUSY",
        details: { sessionWriterLeaseConflict: true }
      }
    });
    expect(fixture.runtimes[1]?.dispose).toHaveBeenCalledOnce();
    expect((await command(fixture.port, taskB, "session.tree", {})).response).toMatchObject({
      ok: false,
      error: { code: "RUNTIME_NOT_READY" }
    });
    expect(fixture.port.sent.some((value) => (
      isEventEnvelope(value)
      && value.type === "session.bootstrap"
      && value.context.scope === "task"
      && value.context.taskId === "task-b"
    ))).toBe(false);

    await fixture.server.shutdown();
  });

  it("continues shutdown cleanup after one Task Runtime disposal fails", async () => {
    const fixture = await createServerFixture(2);
    const workspace = await fixture.workspace("workspace-a");
    temporaryRoots.push(workspace.root);
    await initialize(fixture.port, task("workspace-a", "task-a"), workspace);
    await initialize(fixture.port, task("workspace-a", "task-b"), workspace);
    fixture.runtimes[1]?.dispose.mockRejectedValueOnce(new Error("dispose failed"));

    await expect(fixture.server.shutdown()).rejects.toThrow("dispose failed");
    expect(fixture.runtimes[0]?.dispose).toHaveBeenCalledOnce();
    expect(fixture.runtimes[1]?.dispose).toHaveBeenCalledOnce();
    expect(fixture.port.close).toHaveBeenCalledOnce();
  });

});
