import type {
  ContextFileCatalogResult,
  ContextFileReadResult,
  ContextFileSaveResult,
  ContextFileSummary
} from "@pi67/domain";
import type {
  AgentRuntime,
  ContextFileManagementPort,
  ContextFileSaveTransaction,
  PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import type { AgentCommand, WorkspaceProtocolContext } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { ContextFileCommandRouter } from "./context-file-command-router.js";
import {
  ResourceManagementCoordinator,
  type ResourceManagementTaskView
} from "./resource-management-coordinator.js";

const WORKSPACE: WorkspaceProtocolContext = { scope: "workspace", workspaceId: "workspace-a" };
const REVISION_A = "a".repeat(64);
const REVISION_B = "b".repeat(64);
const GLOBAL_ITEM = item("global", "global");
const PROJECT_ITEM = item("project", "project");

describe("ContextFileCommandRouter", () => {
  it("routes catalog and file reads and requires an idempotency key for saves", async () => {
    const management = createManagement();
    const router = createRouter(management);

    await expect(router.dispatch(WORKSPACE, command("context.file.list", {})))
      .resolves.toEqual(catalog());
    await expect(router.dispatch(WORKSPACE, command("context.file.read", { id: PROJECT_ITEM.id })))
      .resolves.toMatchObject({ item: PROJECT_ITEM, content: "# Project\n", revision: REVISION_A });
    await expect(router.dispatch(WORKSPACE, command("context.file.save", {
      id: PROJECT_ITEM.id,
      expectedRevision: REVISION_A,
      content: "# Updated\n"
    }))).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(management.beginSave).not.toHaveBeenCalled();
  });

  it("replays the same mutation and rejects different content without exposing either body", async () => {
    const management = createManagement();
    const router = createRouter(management);
    const firstBody = "# Private workspace instructions\nsecret-marker-one";
    const secondBody = "# Different private instructions\nsecret-marker-two";
    const firstCommand = command("context.file.save", {
      id: PROJECT_ITEM.id,
      expectedRevision: REVISION_A,
      content: firstBody
    });

    const first = router.dispatch(WORKSPACE, firstCommand, "context-save-1");
    const replay = router.dispatch(WORKSPACE, firstCommand, "context-save-1");
    await expect(Promise.all([first, replay])).resolves.toHaveLength(2);
    expect(management.beginSave).toHaveBeenCalledOnce();

    const failure = await Promise.resolve().then(() => router.dispatch(
      WORKSPACE,
      command("context.file.save", {
        id: PROJECT_ITEM.id,
        expectedRevision: REVISION_A,
        content: secondBody
      }),
      "context-save-1"
    )).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "DUPLICATE_REQUEST" });
    expect(String((failure as Error).message)).not.toContain(firstBody);
    expect(String((failure as Error).message)).not.toContain(secondBody);
    expect(JSON.stringify(failure)).not.toContain("secret-marker");
  });

  it("reloads only initialized Tasks in the mutation scope", async () => {
    const runtimeA = runtime();
    const runtimeB = runtime();
    const runtimeUninitialized = runtime();
    const tasks = [
      task("workspace-a", runtimeA.runtime),
      task("workspace-b", runtimeB.runtime),
      task("workspace-a", runtimeUninitialized.runtime, { initialized: false })
    ];
    const management = createManagement();
    const router = createRouter(management, tasks);

    await expect(router.dispatch(WORKSPACE, command("context.file.save", {
      id: PROJECT_ITEM.id,
      expectedRevision: REVISION_A,
      content: "# Project updated\n"
    }), "project-save")).resolves.toMatchObject({ item: PROJECT_ITEM });
    expect(runtimeA.reloadResources).toHaveBeenCalledOnce();
    expect(runtimeB.reloadResources).not.toHaveBeenCalled();
    expect(runtimeUninitialized.reloadResources).not.toHaveBeenCalled();

    await expect(router.dispatch(WORKSPACE, command("context.file.save", {
      id: GLOBAL_ITEM.id,
      expectedRevision: REVISION_A,
      content: "# Global updated\n"
    }), "global-save")).resolves.toMatchObject({ item: GLOBAL_ITEM });
    expect(runtimeA.reloadResources).toHaveBeenCalledTimes(2);
    expect(runtimeB.reloadResources).toHaveBeenCalledOnce();
    expect(runtimeUninitialized.reloadResources).not.toHaveBeenCalled();
  });

  it("does not begin a disk mutation while an affected Task is busy", async () => {
    const management = createManagement();
    const router = createRouter(management, [
      task("workspace-a", runtime().runtime, { idle: false })
    ]);

    await expect(router.dispatch(WORKSPACE, command("context.file.save", {
      id: PROJECT_ITEM.id,
      expectedRevision: REVISION_A,
      content: "# Must not be written\n"
    }), "busy-save")).rejects.toMatchObject({ code: "BUSY" });
    expect(management.beginSave).not.toHaveBeenCalled();
  });

  it("rolls the file back and reloads the restored resources when reload fails", async () => {
    const reloadError = new Error("reload failed");
    const reloadResources = vi.fn<AgentRuntime["reloadResources"]>()
      .mockRejectedValueOnce(reloadError)
      .mockResolvedValueOnce(reloadResult());
    const rollback = vi.fn(async () => undefined);
    const commit = vi.fn(async () => undefined);
    const management = createManagement({
      beginSave: vi.fn(async (id) => transaction(id === GLOBAL_ITEM.id ? GLOBAL_ITEM : PROJECT_ITEM, {
        commit,
        rollback
      }))
    });
    const router = createRouter(management, [
      task("workspace-a", { reloadResources } as unknown as AgentRuntime)
    ]);

    await expect(router.dispatch(WORKSPACE, command("context.file.save", {
      id: PROJECT_ITEM.id,
      expectedRevision: REVISION_A,
      content: "# Updated\n"
    }), "rollback-save")).rejects.toBe(reloadError);
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
    expect(reloadResources).toHaveBeenCalledTimes(2);
  });
});

function createRouter(
  management: ReturnType<typeof createManagement>,
  tasks: ResourceManagementTaskView[] = []
): ContextFileCommandRouter {
  return new ContextFileCommandRouter({
    getWorkspaceServices: () => ({}) as PiWorkspaceRuntimeServices,
    createManagement: () => management,
    coordinator: new ResourceManagementCoordinator({ listTasks: () => tasks })
  });
}

function createManagement(
  overrides: Partial<ContextFileManagementPort> = {}
): ContextFileManagementPort & {
  beginSave: ReturnType<typeof vi.fn<ContextFileManagementPort["beginSave"]>>;
} {
  const beginSave = overrides.beginSave
    ? vi.fn(overrides.beginSave)
    : vi.fn<ContextFileManagementPort["beginSave"]>(async (id) => (
      transaction(id === GLOBAL_ITEM.id ? GLOBAL_ITEM : PROJECT_ITEM)
    ));
  return {
    list: async () => catalog(),
    read: async (id) => readResult(id === GLOBAL_ITEM.id ? GLOBAL_ITEM : PROJECT_ITEM),
    mutationScope: async (id) => id === GLOBAL_ITEM.id ? "global" : "project",
    ...overrides,
    beginSave
  };
}

function transaction(
  savedItem: ContextFileSummary,
  overrides: Partial<Pick<ContextFileSaveTransaction, "commit" | "rollback">> = {}
): ContextFileSaveTransaction {
  return {
    result: saveResult(savedItem),
    commit: overrides.commit ?? vi.fn(async () => undefined),
    rollback: overrides.rollback ?? vi.fn(async () => undefined)
  };
}

function catalog(): ContextFileCatalogResult {
  return { items: [GLOBAL_ITEM, PROJECT_ITEM], workspaceTrusted: true };
}

function readResult(selected: ContextFileSummary): ContextFileReadResult {
  return {
    item: selected,
    content: selected.scope === "global" ? "# Global\n" : "# Project\n",
    revision: REVISION_A
  };
}

function saveResult(savedItem: ContextFileSummary): ContextFileSaveResult {
  return { item: savedItem, revision: REVISION_B, files: catalog() };
}

function item(seed: string, scope: "global" | "project"): ContextFileSummary {
  return {
    id: `ctx_${seed === "global" ? "1" : "2"}`.padEnd(68, seed === "global" ? "1" : "2"),
    name: "AGENTS.md",
    path: `/${scope}/AGENTS.md`,
    category: "rules-context",
    scope,
    origin: scope === "global" ? "user" : "workspace",
    presence: "present",
    access: "editable",
    runtimeState: "active"
  };
}

function task(
  workspaceId: string,
  activeRuntime: AgentRuntime,
  options: { initialized?: boolean; idle?: boolean } = {}
): ResourceManagementTaskView {
  return {
    taskKey: `${workspaceId}:context-task`,
    workspaceId,
    runtime: activeRuntime,
    initialized: options.initialized ?? true,
    isIdle: () => options.idle ?? true
  };
}

function runtime(): {
  runtime: AgentRuntime;
  reloadResources: ReturnType<typeof vi.fn<AgentRuntime["reloadResources"]>>;
} {
  const reloadResources = vi.fn<AgentRuntime["reloadResources"]>(async () => reloadResult());
  return {
    runtime: { reloadResources } as unknown as AgentRuntime,
    reloadResources
  };
}

function reloadResult(): Awaited<ReturnType<AgentRuntime["reloadResources"]>> {
  return {
    sessionId: "session-context",
    controls: { thinkingLevel: "off" },
    modelCatalog: { models: [], providers: [], availableThinkingLevels: [] },
    resources: []
  };
}

function command<T extends "context.file.list" | "context.file.read" | "context.file.save">(
  type: T,
  payload: AgentCommand<T>["payload"]
): AgentCommand<T> {
  return { type, payload } as AgentCommand<T>;
}
