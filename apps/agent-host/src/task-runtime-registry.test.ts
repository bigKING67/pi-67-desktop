import { describe, expect, it, vi } from "vitest";
import type {
  AgentRuntime,
  PiSdkRuntimeOptions,
  PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import { createRuntimeCredentialOverrideStore } from "@pi67/pi-runtime";
import type { PromptAttachmentAccessOwner } from "./prompt-attachment-access.js";
import { TaskRuntimeRegistry } from "./task-runtime-registry.js";

describe("TaskRuntimeRegistry", () => {
  it("loads one independent Runtime per Task with shared Host credentials and Workspace services", async () => {
    const loadedOptions: PiSdkRuntimeOptions[] = [];
    const runtimes = [runtime(), runtime()];
    const loader = vi.fn(async (options?: PiSdkRuntimeOptions) => {
      loadedOptions.push(options ?? {});
      return runtimes[loadedOptions.length - 1]!;
    });
    const credentials = createRuntimeCredentialOverrideStore();
    const workspaceServices = {} as PiWorkspaceRuntimeServices;
    const registry = new TaskRuntimeRegistry(loader, credentials);

    const first = await registry.load(context("task-a"), workspaceServices);
    const second = await registry.load(context("task-b"), workspaceServices);
    expect(first).not.toBe(second);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loadedOptions).toEqual([
      { runtimeCredentialOverrides: credentials, workspaceServices },
      { runtimeCredentialOverrides: credentials, workspaceServices }
    ]);
    await registry.disposeAll();
    expect(runtimes[0]!.disposeSpy).toHaveBeenCalledOnce();
    expect(runtimes[1]!.disposeSpy).toHaveBeenCalledOnce();
  });

  it("rejects stale Task generations and a Runtime reused across Tasks", async () => {
    const shared = runtime();
    const registry = new TaskRuntimeRegistry(
      async () => shared,
      createRuntimeCredentialOverrideStore()
    );
    await registry.load(context("task-a"));
    expect(() => registry.admit({ ...context("task-a"), taskGeneration: 2 }))
      .toThrow(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
    await expect(registry.load(context("task-b"))).rejects.toMatchObject({ code: "INTERNAL" });
    await registry.disposeAll();
  });

  it("rejects a Session request for a different physical JSONL identity", async () => {
    let sessionPath = "/sessions/original.jsonl";
    const active = runtime(() => ({
      sessionId: "session-1",
      sessionFileIdentity: "session-file-1",
      sessionPath,
      sessionGeneration: 2
    }));
    const registry = new TaskRuntimeRegistry(
      async () => active,
      createRuntimeCredentialOverrideStore()
    );
    await registry.load(context("task-a"));

    const authority = {
      ...context("task-a"),
      sessionId: "session-1",
      sessionFileIdentity: "session-file-1",
      sessionGeneration: 2
    } as const;
    expect(() => registry.assertSessionAuthority(authority)).not.toThrow();
    sessionPath = "/sessions/relocated.jsonl";
    expect(() => registry.assertSessionAuthority(authority)).not.toThrow();
    expect(() => registry.assertSessionAuthority({
      ...authority,
      sessionFileIdentity: "session-file-other"
    })).toThrow(expect.objectContaining({ code: "STALE_SESSION_IDENTITY" }));

    await registry.disposeAll();
  });

  it("admits a newer generation after the previous Task Runtime is closed", async () => {
    const runtimes = [runtime(), runtime()];
    const registry = new TaskRuntimeRegistry(
      async () => runtimes.shift()!,
      createRuntimeCredentialOverrideStore()
    );
    await registry.load(context("task-a"));
    await registry.disposeTask(context("task-a"));

    const reopened = { ...context("task-a"), taskGeneration: 2 };
    await expect(registry.load(reopened)).resolves.toBeDefined();
    expect(registry.get(reopened)).toMatchObject({
      context: reopened,
      closed: false
    });
    await registry.disposeAll();
  });

  it("releases claimed attachment storage when a Task closes", async () => {
    const attachments = attachmentOwner();
    const registry = new TaskRuntimeRegistry(
      async () => runtime(),
      createRuntimeCredentialOverrideStore(),
      {},
      attachments
    );
    await registry.load(context("task-a"));

    await registry.disposeTask(context("task-a"));

    expect(attachments.releaseTask).toHaveBeenCalledWith(JSON.stringify(["workspace-1", "task-a"]));
  });

  it("releases claimed attachment storage for every Task during Host shutdown", async () => {
    const attachments = attachmentOwner();
    const registry = new TaskRuntimeRegistry(
      async () => runtime(),
      createRuntimeCredentialOverrideStore(),
      {},
      attachments
    );
    await registry.load(context("task-a"));
    await registry.load(context("task-b"));

    await registry.disposeAll();

    expect(attachments.releaseTask.mock.calls.map(([taskKey]) => taskKey)).toEqual([
      JSON.stringify(["workspace-1", "task-b"]),
      JSON.stringify(["workspace-1", "task-a"])
    ]);
  });

  it("keeps failed Runtime attachments while cleaning Tasks whose writer was released", async () => {
    const runtimes = [runtime(), runtime()];
    runtimes[1]!.disposeSpy.mockRejectedValueOnce(new Error("task-b dispose failed"));
    const attachments = attachmentOwner();
    const registry = new TaskRuntimeRegistry(
      async () => runtimes.shift()!,
      createRuntimeCredentialOverrideStore(),
      {},
      attachments
    );
    await registry.load(context("task-a"));
    await registry.load(context("task-b"));

    await expect(registry.disposeAll()).rejects.toThrow("task-b dispose failed");

    expect(attachments.releaseTask).toHaveBeenCalledOnce();
    expect(attachments.releaseTask).toHaveBeenCalledWith(JSON.stringify(["workspace-1", "task-a"]));
    expect(registry.values().map((record) => record.context.taskId)).toEqual(["task-b"]);
  });

  it("retains a failed Runtime disposal fence and retries it during Host shutdown", async () => {
    const active = runtime();
    active.disposeSpy.mockRejectedValueOnce(new Error("dispose failed"));
    const attachments = attachmentOwner();
    const registry = new TaskRuntimeRegistry(
      async () => active,
      createRuntimeCredentialOverrideStore(),
      {},
      attachments
    );
    await registry.load(context("task-a"));

    await expect(registry.disposeTask(context("task-a"))).rejects.toThrow("dispose failed");
    expect(attachments.releaseTask).not.toHaveBeenCalled();
    expect(() => registry.admit({ ...context("task-a"), taskGeneration: 2 }))
      .toThrow(expect.objectContaining({ code: "INVALID_PAYLOAD" }));

    await registry.disposeAll();
    expect(active.disposeSpy).toHaveBeenCalledTimes(2);
    expect(attachments.releaseTask).toHaveBeenCalledOnce();
    expect(registry.values()).toEqual([]);
  });

  it("retries claimed attachment cleanup after Runtime disposal has committed", async () => {
    const active = runtime();
    const attachments = attachmentOwner();
    attachments.releaseTask.mockRejectedValueOnce(new Error("attachment cleanup failed"));
    const registry = new TaskRuntimeRegistry(
      async () => active,
      createRuntimeCredentialOverrideStore(),
      {},
      attachments
    );
    await registry.load(context("task-a"));

    await expect(registry.disposeTask(context("task-a"))).rejects.toThrow("attachment cleanup failed");
    expect(active.disposeSpy).toHaveBeenCalledOnce();
    expect(registry.get(context("task-a"))).toMatchObject({
      runtime: undefined,
      closed: true,
      attachmentCleanupPending: true
    });

    await expect(registry.disposeTask(context("task-a"))).resolves.toBe(false);
    expect(active.disposeSpy).toHaveBeenCalledOnce();
    expect(attachments.releaseTask).toHaveBeenCalledTimes(2);
    expect(registry.get(context("task-a"))?.attachmentCleanupPending).toBe(false);
  });
});

function attachmentOwner(): PromptAttachmentAccessOwner & { releaseTask: ReturnType<typeof vi.fn> } {
  const releaseTask = vi.fn(async () => undefined);
  return {
    forTask: vi.fn(() => ({
      claim: vi.fn(),
      readImages: vi.fn(),
      read: vi.fn()
    })),
    releaseTask,
    dispose: vi.fn(async () => undefined)
  } as unknown as PromptAttachmentAccessOwner & { releaseTask: ReturnType<typeof vi.fn> };
}

function context(taskId: string) {
  return {
    scope: "task" as const,
    workspaceId: "workspace-1",
    taskId,
    taskGeneration: 1
  };
}

function runtime(
  getIdentity: AgentRuntime["getIdentity"] = () => ({ sessionGeneration: 0 })
) {
  const disposeSpy = vi.fn(async () => undefined);
  return { dispose: disposeSpy, disposeSpy, getIdentity } as unknown as AgentRuntime & {
    disposeSpy: typeof disposeSpy;
  };
}
