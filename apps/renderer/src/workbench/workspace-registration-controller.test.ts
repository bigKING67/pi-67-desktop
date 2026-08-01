import type { WorkspaceDescriptor } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { resumeRendererTask } from "./task-activation-controller.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import { registerRendererWorkspaceWithHost } from "./workspace-host-registration-controller.js";
import {
  moveRendererWorkspace,
  removeRendererWorkspace,
  repairAndOpenRendererWorkspace,
  workspaceOrderAfterDrop,
  workspaceRemovalDisposition
} from "./workspace-registration-controller.js";

vi.mock("../connection/connection-recovery.js", () => ({
  ensureAgentConnection: vi.fn()
}));

vi.mock("../workspace/workspace-open-controller.js", () => ({
  openRendererWorkspaceDescriptor: vi.fn()
}));

vi.mock("./task-activation-controller.js", () => ({
  resumeRendererTask: vi.fn()
}));

vi.mock("./workspace-host-registration-controller.js", () => ({
  registerRendererWorkspaceWithHost: vi.fn()
}));

const ensureConnection = vi.mocked(ensureAgentConnection);
const openWorkspace = vi.mocked(openRendererWorkspaceDescriptor);
const resumeTask = vi.mocked(resumeRendererTask);
const registerWorkspace = vi.mocked(registerRendererWorkspaceWithHost);
const removeWorkspace = vi.fn();
const reorderWorkspaces = vi.fn();
const repairWorkspace = vi.fn();

describe("workspace registration controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ensureConnection.mockReset().mockResolvedValue({
      appInstanceId: "app",
      hostInstanceId: "host",
      hostEpoch: 9,
      sdkVersion: "fixture",
      eventSequence: 0
    });
    openWorkspace.mockReset().mockResolvedValue(true);
    resumeTask.mockReset().mockResolvedValue(true);
    registerWorkspace.mockReset().mockResolvedValue(true);
    rendererWorkbenchStore.getState().reset();
    rendererWorkbenchStore.getState().registerWorkspace(workspace());
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    removeWorkspace.mockReset().mockResolvedValue({});
    reorderWorkspaces.mockReset().mockResolvedValue({});
    repairWorkspace.mockReset();
    vi.stubGlobal("window", {
      pi67: {
        system: {
          removeWorkspace,
          reorderWorkspaces,
          repairWorkspace,
          updateWorkbenchLayout: vi.fn()
        }
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves a dragged workspace across the drop target without losing ids", () => {
    expect(workspaceOrderAfterDrop(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(workspaceOrderAfterDrop(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("ignores missing ids and a drop onto the same workspace", () => {
    expect(workspaceOrderAfterDrop(["a", "b"], "a", "a")).toBeUndefined();
    expect(workspaceOrderAfterDrop(["a", "b"], "missing", "b")).toBeUndefined();
    expect(workspaceOrderAfterDrop(["a", "b"], "a", "missing")).toBeUndefined();
  });

  it("distinguishes missing, active, and safely removable Workspaces", () => {
    expect(workspaceRemovalDisposition("missing")).toBe("workspace-missing");
    expect(workspaceRemovalDisposition("workspace-a")).toBe("allowed");

    useAppStore.setState({ workspace: "/work/a" });
    expect(workspaceRemovalDisposition("workspace-a")).toBe("workspace-active");

    useAppStore.setState({ workspace: undefined });
    rendererWorkbenchStore.getState().openTask(task({ runtimePhase: "busy" }));
    expect(workspaceRemovalDisposition("workspace-a")).toBe("tasks-open");

    rendererWorkbenchStore.getState().updateTask("task-a", {
      lifecycle: "stopped",
      runtime: { phase: "stopped", detail: "stopped", recoverable: true }
    });
    expect(workspaceRemovalDisposition("workspace-a")).toBe("allowed");

    rendererWorkbenchStore.getState().updateTask("task-a", { hasDraft: true });
    expect(workspaceRemovalDisposition("workspace-a")).toBe("tasks-open");
  });

  it("returns host-busy without mutating either Workspace registry", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new ProtocolRequestError({
      code: "BUSY",
      message: "Workspace still owns an active Runtime.",
      recoverable: true
    }));

    await expect(removeRendererWorkspace("workspace-a")).resolves.toBe("host-busy");

    expect(rendererWorkbenchStore.getState().workspaces["workspace-a"]).toBeDefined();
    expect(removeWorkspace).not.toHaveBeenCalled();
  });

  it("re-registers the Host Workspace when a Task starts during removal", async () => {
    vi.spyOn(agentConnectionController, "request").mockImplementation(async () => {
      rendererWorkbenchStore.getState().openTask(task({ runtimePhase: "busy" }));
      return {} as never;
    });

    await expect(removeRendererWorkspace("workspace-a")).resolves.toBe("tasks-open");

    expect(registerWorkspace).toHaveBeenCalledWith(workspace(), { queryCatalog: false });
    expect(removeWorkspace).not.toHaveBeenCalled();
  });

  it("removes a quiescent Workspace from Main, renderer state, and Catalog state", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);
    useSessionCatalogStore.getState().beginFirstPage("workspace-a");

    await expect(removeRendererWorkspace("workspace-a")).resolves.toBe("allowed");

    expect(removeWorkspace).toHaveBeenCalledWith("workspace-a");
    expect(rendererWorkbenchStore.getState().workspaces["workspace-a"]).toBeUndefined();
    expect(useSessionCatalogStore.getState().byWorkspace["workspace-a"]).toMatchObject({
      items: [],
      loading: false,
      loadingMore: false
    });
  });

  it("persists a valid move before applying the same local order", async () => {
    rendererWorkbenchStore.getState().registerWorkspace(workspace({ id: "workspace-b", path: "/work/b" }));

    await expect(moveRendererWorkspace("workspace-a", "up")).resolves.toBe(false);
    expect(reorderWorkspaces).not.toHaveBeenCalled();

    await expect(moveRendererWorkspace("workspace-a", "down")).resolves.toBe(true);
    expect(reorderWorkspaces).toHaveBeenCalledWith(["workspace-b", "workspace-a"]);
    expect(rendererWorkbenchStore.getState().workspaceOrder).toEqual(["workspace-b", "workspace-a"]);
  });

  it("returns false when native directory repair is cancelled", async () => {
    repairWorkspace.mockResolvedValue(undefined);

    await expect(repairAndOpenRendererWorkspace("workspace-a")).resolves.toBe(false);

    expect(registerWorkspace).not.toHaveBeenCalled();
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it("resumes the selected Session after repairing its Workspace identity", async () => {
    rendererWorkbenchStore.getState().registerWorkspace(workspace({ availability: "identity-changed" }));
    rendererWorkbenchStore.getState().openTask(task({ runtimePhase: "stopped" }));
    const repaired = workspace();
    repairWorkspace.mockResolvedValue(repaired);

    await expect(repairAndOpenRendererWorkspace("workspace-a")).resolves.toBe(true);

    expect(registerWorkspace).toHaveBeenCalledWith(repaired, { refreshCatalog: true });
    expect(resumeTask).toHaveBeenCalledWith("task-a");
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it("opens a repaired Workspace when no Session Task was selected", async () => {
    const repaired = workspace();
    repairWorkspace.mockResolvedValue(repaired);
    openWorkspace.mockImplementation(async () => {
      useAppStore.setState({ workspace: repaired.identity.canonicalPath });
      return true;
    });

    await expect(repairAndOpenRendererWorkspace("workspace-a")).resolves.toBe(true);

    expect(openWorkspace).toHaveBeenCalledWith(repaired);
    expect(resumeTask).not.toHaveBeenCalled();
  });
});

function workspace(options: {
  id?: string;
  path?: string;
  availability?: WorkspaceDescriptor["availability"];
} = {}): WorkspaceDescriptor {
  const id = options.id ?? "workspace-a";
  return {
    id,
    displayName: id,
    identity: {
      canonicalPath: options.path ?? "/work/a",
      assurance: "filesystem",
      device: "1",
      inode: id
    },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: options.availability ?? "available"
  };
}

function task(options: { runtimePhase: "busy" | "stopped" }) {
  const stopped = options.runtimePhase === "stopped";
  return {
    id: "task-a",
    conversation: {
      kind: "session" as const,
      workspaceId: "workspace-a",
      sessionPath: "/sessions/a.jsonl"
    },
    workspaceId: "workspace-a",
    sessionId: "session-a",
    taskGeneration: 1,
    sessionGeneration: 2,
    lifecycle: stopped ? "stopped" as const : "running" as const,
    runtime: {
      phase: options.runtimePhase,
      detail: options.runtimePhase,
      recoverable: true
    },
    title: "A",
    sessionPath: "/sessions/a.jsonl",
    hasDraft: false,
    toolMode: "auto" as const,
    attachmentCount: 0
  };
}
