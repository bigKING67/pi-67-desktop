import { afterEach, describe, expect, it } from "vitest";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { composerDraftActions } from "./composer-draft-actions.js";
import type { DraftAttachment } from "./composer-attachments.js";

describe("composer draft actions", () => {
  afterEach(() => {
    for (const taskId of Object.keys(useTaskDraftStore.getState().drafts)) {
      useTaskDraftStore.getState().setAttachments(taskId, []);
    }
    useTaskDraftStore.getState().dispose();
  });

  it("keeps missing Task actions inert", () => {
    const actions = composerDraftActions(undefined);
    actions.setText("ignored");
    actions.setAttachments([attachment("ignored")]);
    actions.setWorkspaceFiles([{ id: "file", revision: "r1", relativePath: "src/file.ts" }]);
    actions.setStreamBehavior("steer");

    expect(useTaskDraftStore.getState().drafts).toEqual({});
  });

  it("updates direct and functional Task-bound draft values", () => {
    const actions = composerDraftActions("task-a");
    actions.setText("draft");
    actions.setAttachments([attachment("a")]);
    actions.setAttachments((current) => [...current, attachment("b")]);
    actions.setWorkspaceFiles([{ id: "file-a", revision: "r1", relativePath: "src/a.ts" }]);
    actions.setWorkspaceFiles((current) => [
      ...current,
      { id: "file-b", revision: "r2", relativePath: "src/b.ts" }
    ]);
    actions.setStreamBehavior("steer");

    expect(useTaskDraftStore.getState().drafts["task-a"]).toMatchObject({
      text: "draft",
      attachments: [{ id: "a" }, { id: "b" }],
      workspaceFiles: [{ id: "file-a" }, { id: "file-b" }],
      streamBehavior: "steer"
    });
  });

  it("passes empty collections to functional updates for a pristine Task", () => {
    composerDraftActions("task-attachments").setAttachments((current) => {
      expect(current).toEqual([]);
      return [attachment("a")];
    });
    composerDraftActions("task-workspace").setWorkspaceFiles((current) => {
      expect(current).toEqual([]);
      return [{ id: "file-a", revision: "r1", relativePath: "src/a.ts" }];
    });

    expect(useTaskDraftStore.getState().drafts["task-workspace"]?.workspaceFiles).toEqual([
      { id: "file-a", revision: "r1", relativePath: "src/a.ts" }
    ]);
  });
});

function attachment(id: string): DraftAttachment {
  return {
    id,
    identity: `identity-${id}`,
    name: `${id}.txt`,
    mimeType: "text/plain",
    byteLength: 1,
    kind: "document"
  };
}
