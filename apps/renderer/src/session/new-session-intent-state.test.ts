import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { workspaceDescriptorFixture } from "../app/workspace-open-test-fixtures.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import { beginRendererSessionIntent } from "./session-lifecycle-controller.js";

describe("new Session intent after Workspace startup", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useAppStore.setState(useAppStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace(
      workspaceDescriptorFixture("workspace-a", "/work/a", "filesystem")
    );
  });

  it.each(["draft", "initializing", "lost"] as const)(
    "reuses an empty provisional only if it is a draft, not %s startup state",
    (lifecycle) => {
      const previousId = beginRendererSessionIntent()!;
      rendererWorkbenchStore.getState().updateTask(previousId, { lifecycle });

      const nextId = beginRendererSessionIntent()!;

      expect(nextId === previousId).toBe(lifecycle === "draft");
      expect(rendererWorkbenchStore.getState().tasks[nextId]?.lifecycle).toBe("draft");
      expect(useAppStore.getState().connected).toBe(false);
      expect(rendererWorkbenchStore.getState().tasks[nextId]?.creationId).toBeUndefined();
    }
  );
});
