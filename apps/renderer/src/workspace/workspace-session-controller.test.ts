import type { WorkspaceDescriptor } from "@pi67/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { beginRendererSessionIntent } from "../session/session-lifecycle-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { selectRendererWorkspaceDescriptor } from "./workspace-open-controller.js";
import { beginRendererSessionIntentInWorkspace } from "./workspace-session-controller.js";

vi.mock("../session/session-lifecycle-controller.js", () => ({
  beginRendererSessionIntent: vi.fn()
}));

vi.mock("./workspace-open-controller.js", () => ({
  selectRendererWorkspaceDescriptor: vi.fn().mockResolvedValue(true)
}));

const beginIntent = vi.mocked(beginRendererSessionIntent);
const selectWorkspace = vi.mocked(selectRendererWorkspaceDescriptor);

describe("workspace Session creation controller", () => {
  beforeEach(() => {
    beginIntent.mockReset();
    selectWorkspace.mockReset().mockResolvedValue(true);
    rendererWorkbenchStore.getState().reset();
    useAppStore.setState(useAppStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace(workspace("workspace-a", "/work/a"));
    rendererWorkbenchStore.getState().registerWorkspace(workspace("workspace-b", "/work/b"));
    useAppStore.setState({ workspace: "/work/a" });
  });

  it("selects another Workspace without default-opening a Session, then creates exactly once", async () => {
    const target = workspace("workspace-b", "/work/b");

    await beginRendererSessionIntentInWorkspace(target);

    expect(selectWorkspace).toHaveBeenCalledOnce();
    expect(selectWorkspace).toHaveBeenCalledWith(target);
    expect(beginIntent).toHaveBeenCalledOnce();
    expect(beginIntent).toHaveBeenCalledWith(target.id);
  });

  it("creates directly in the already-live Workspace", async () => {
    const target = workspace("workspace-a", "/work/a");

    await beginRendererSessionIntentInWorkspace(target);

    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().currentWorkspaceId).toBe(target.id);
    expect(beginIntent).toHaveBeenCalledOnce();
    expect(beginIntent).toHaveBeenCalledWith(target.id);
  });

  it("does not create when selecting the target Workspace fails", async () => {
    selectWorkspace.mockResolvedValue(false);

    await beginRendererSessionIntentInWorkspace(workspace("workspace-b", "/work/b"));

    expect(beginIntent).not.toHaveBeenCalled();
  });
});

function workspace(id: string, canonicalPath: string): WorkspaceDescriptor {
  return {
    id,
    displayName: id,
    identity: { canonicalPath, assurance: "path-only" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}
