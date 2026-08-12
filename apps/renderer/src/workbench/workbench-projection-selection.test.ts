import { describe, expect, it } from "vitest";
import {
  existingWorkbenchProjectionOwner,
  installNewWorkbenchProjection
} from "./WorkbenchProjectionBridge.js";
import {
  createRendererWorkbenchStore,
  type RendererWorkbenchTask
} from "./workbench-store.js";

describe("Workbench projection selection", () => {
  it("keeps a creating provisional selected when an older projection arrives late", () => {
    const store = workbenchStore();
    const provisional = provisionalTask("task-new", "session-creation-new");
    store.getState().openTask(provisional);
    const projected = sessionTask("task-late-projection", "previous");
    const owner = existingWorkbenchProjectionOwner(
      store.getState().tasks,
      provisional,
      "workspace-a",
      projected.sessionFileIdentity!
    );

    expect(owner).toBeUndefined();
    installNewWorkbenchProjection(store.getState(), projected);

    expect(store.getState().tasks[projected.id]).toEqual(projected);
    expect(store.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: provisional.conversation
    });
  });

  it("allows an unbound Workspace startup placeholder to own its projection", () => {
    const placeholder = provisionalTask("task-startup");

    expect(existingWorkbenchProjectionOwner(
      { [placeholder.id]: placeholder },
      placeholder,
      "workspace-a",
      "session-file-startup"
    )).toBe(placeholder);
  });

  it("selects a new projection when no conversation selection would be displaced", () => {
    const store = workbenchStore();
    const projected = sessionTask("task-projected", "projected");

    installNewWorkbenchProjection(store.getState(), projected);

    expect(store.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: projected.conversation
    });
  });
});

function workbenchStore() {
  const store = createRendererWorkbenchStore();
  store.getState().registerWorkspace({
    id: "workspace-a",
    displayName: "A",
    identity: { canonicalPath: "/work/a", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  });
  return store;
}

function provisionalTask(id: string, creationId?: string): RendererWorkbenchTask {
  return {
    id,
    conversation: { kind: "provisional", workspaceId: "workspace-a", draftId: id },
    workspaceId: "workspace-a",
    sessionId: `pending:${id}`,
    taskGeneration: 1,
    lifecycle: "initializing",
    runtime: { phase: "starting", detail: "starting", recoverable: true },
    title: "Draft",
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0,
    ...(creationId ? { creationId, creationStatus: "pending" as const } : {})
  };
}

function sessionTask(id: string, identity: string): RendererWorkbenchTask {
  const sessionPath = `/sessions/${identity}.jsonl`;
  return {
    id,
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionFileIdentity: `session-file-${identity}`,
      sessionPath
    },
    workspaceId: "workspace-a",
    sessionId: `session-${identity}`,
    sessionFileIdentity: `session-file-${identity}`,
    sessionGeneration: 1,
    taskGeneration: 1,
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "ready", recoverable: true },
    title: identity,
    sessionPath,
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0
  };
}
