import { beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { workspaceDescriptorFixture } from "../app/workspace-open-test-fixtures.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { persistRendererWorkbenchCheckpoint } from "../workbench/workbench-controller.js";
import { beginRendererSessionIntent } from "./session-creation-controller.js";
import { saveWorkspaceConversationDefault, selectDraftConversationScope } from "./workspace-conversation-default-controller.js";
vi.mock("../workbench/workbench-controller.js", () => ({ persistRendererWorkbenchCheckpoint: vi.fn() }));
const choice = { kind: "team" as const, teamId: "t", projectId: "p", teamName: "团队", projectName: "项目", userId: "u", serviceEndpoint: "https://example.com" };
beforeEach(() => {
  rendererWorkbenchStore.getState().reset(); useTaskDraftStore.getState().dispose();
  useAppStore.setState(useAppStore.getInitialState(), true);
  rendererWorkbenchStore.getState().registerWorkspace(workspaceDescriptorFixture("w", "/work/w", "filesystem"));
  vi.mocked(persistRendererWorkbenchCheckpoint).mockReset().mockResolvedValue();
});
it("changes an empty draft in place and keeps temporary private selection separate from the saved default", async () => {
  await saveWorkspaceConversationDefault("w", choice);
  const id = beginRendererSessionIntent()!;
  expect(selectDraftConversationScope(id, { kind: "private" })).toBe(id);
  expect(rendererWorkbenchStore.getState().tasks[id]?.teamScope).toBeUndefined();
  expect(rendererWorkbenchStore.getState().conversationDefaults?.[0]?.choice).toEqual(choice);
  const next = beginRendererSessionIntent()!;
  expect(rendererWorkbenchStore.getState().tasks[next]?.teamScope).toEqual({ teamId: "t", projectId: "p" });
});
it("preserves text and opens separate empty work; selecting the same scope does not split a draft", () => {
  const id = beginRendererSessionIntent()!;
  useTaskDraftStore.getState().setText(id, "private content");
  const teamId = selectDraftConversationScope(id, choice)!;
  expect(teamId).not.toBe(id);
  expect(useTaskDraftStore.getState().drafts[id]?.text).toBe("private content");
  useTaskDraftStore.getState().setText(teamId, "team content");
  expect(selectDraftConversationScope(teamId, choice)).toBe(teamId);
  expect(Object.keys(rendererWorkbenchStore.getState().tasks)).toHaveLength(2);
});
it("rolls back in-memory defaults on persistence failure without changing the current draft", async () => {
  const id = beginRendererSessionIntent()!;
  vi.mocked(persistRendererWorkbenchCheckpoint).mockRejectedValue(new Error("disk unavailable"));
  await expect(saveWorkspaceConversationDefault("w", choice)).rejects.toThrow("disk unavailable");
  expect(rendererWorkbenchStore.getState().conversationDefaults).toEqual([]);
  expect(rendererWorkbenchStore.getState().tasks[id]?.teamScope).toBeUndefined();
});
it("rejects scope changes during creation", () => {
  const id = beginRendererSessionIntent()!;
  rendererWorkbenchStore.getState().updateTask(id, { creationStatus: "pending" });
  expect(selectDraftConversationScope(id, choice)).toBeUndefined();
  expect(rendererWorkbenchStore.getState().tasks[id]?.teamScope).toBeUndefined();
});
