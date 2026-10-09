import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolRequestError } from "@pi67/protocol";

const host = vi.hoisted(() => ({ revision: 1, calls: [] as { type: string; payload: Record<string, unknown> }[], conflictNext: false }));

vi.mock("../connection/AgentConnectionController.js", () => ({
  agentConnectionController: {
    subscribe: () => () => undefined,
    request: (type: string, payload: Record<string, unknown>) => {
      host.calls.push({ type, payload });
      if (type === "image.project.read") return Promise.resolve({ projectId: "p", revision: host.revision, latestRevision: host.revision, sha256: "s", document: { title: "海报", canvas: { width: 100, height: 100, background: "#fff" }, objects: [] } });
      if (type === "image.project.render") return Promise.resolve({ projectId: "p", revision: host.revision, pngSha256: "a".repeat(64), width: 100, height: 100 });
      if (type === "image.candidate.list") return Promise.resolve({ projectId: "p", candidates: [] });
      if (type === "image.project.edit") {
        if (host.conflictNext) {
          host.conflictNext = false; host.revision += 1;
          return Promise.reject(new ProtocolRequestError({ code: "RESOURCE_CHANGED_EXTERNALLY", message: "Revision conflict", recoverable: true, details: { imageReason: "revision_conflict" } }));
        }
        host.revision += 1;
        return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s", dryRun: false });
      }
      return Promise.reject(new Error(`unexpected ${type}`));
    }
  }
}));
vi.mock("../notifications/notification-store.js", () => ({ publishNotification: vi.fn() }));

import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { editImageProject, loadImageProject, redoImageEdit, undoImageEdit, useImageProject } from "./image-project-controller.js";

const edits = () => host.calls.filter((call) => call.type === "image.project.edit").map((call) => call.payload);

beforeEach(async () => {
  host.revision = 1; host.calls = []; host.conflictNext = false;
  rendererWorkbenchStore.setState({ imageLibraryWorkspaceId: "lib" });
  useImageProject.setState({ projectId: undefined });
  await loadImageProject("p");
});

describe("image project editing", () => {
  it("submits against the revision on screen and undoes to the content shown before, not revision - 1", async () => {
    expect(await editImageProject("改标题", [{ type: "update_object", id: "t", patch: { text: "春" } }])).toEqual({ outcome: "applied" });
    await editImageProject("移动", [{ type: "update_object", id: "t", patch: { x: 4 } }]);
    expect(useImageProject.getState()).toMatchObject({ revision: 3, back: [1, 2], forward: [] });
    await undoImageEdit();
    await undoImageEdit();
    await redoImageEdit();
    expect(edits().map((payload) => [payload.baseRevision, (payload.operations as { type: string; revision?: number }[])[0]])).toEqual([
      [1, { type: "update_object", id: "t", patch: { text: "春" } }], [2, { type: "update_object", id: "t", patch: { x: 4 } }],
      [3, { type: "revert_to", revision: 2 }], [4, { type: "revert_to", revision: 1 }], [5, { type: "revert_to", revision: 4 }]
    ]);
    expect(useImageProject.getState()).toMatchObject({ revision: 6, back: [5], forward: [3] });
    await editImageProject("新改动", [{ type: "update_object", id: "t", patch: { y: 1 } }]);
    expect(useImageProject.getState().forward).toEqual([]);
  });

  it("refreshes on a conflict and reports it so the caller keeps the draft", async () => {
    host.conflictNext = true;
    expect(await editImageProject("改标题", [{ type: "update_object", id: "t", patch: { text: "春" } }])).toEqual({ outcome: "conflict" });
    expect(useImageProject.getState()).toMatchObject({ revision: 2, back: [] });
    expect(await editImageProject("改标题", [{ type: "update_object", id: "t", patch: { text: "春" } }])).toEqual({ outcome: "applied" });
    expect(edits().at(-1)?.baseRevision).toBe(2);
  });
});
