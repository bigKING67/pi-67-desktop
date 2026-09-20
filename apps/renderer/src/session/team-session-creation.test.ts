import { beforeEach, expect, it, vi } from "vitest";
import { ProtocolRequestError } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { workspaceConnectionIdentity, workspaceDescriptorFixture } from "../app/workspace-open-test-fixtures.js";
import { runSessionBootstrapTransition } from "../app/session-transition.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { ensureRendererSessionCreationAuthority } from "./session-creation-authority.js";
import { beginRendererSessionIntent, createRendererSession, materializeRendererSessionIntent } from "./session-creation-controller.js";
import { restorePersistedDrafts, serializeTaskDraftState } from "../workbench/task-draft-persistence.js";
import { parseComposerDraftPersistedState } from "../../../desktop/src/composer-draft-state.js";

vi.mock("../app/session-transition.js", () => ({ runSessionBootstrapTransition: vi.fn() }));
vi.mock("./session-creation-authority.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-creation-authority.js")>()),
  ensureRendererSessionCreationAuthority: vi.fn()
}));
const bootstrap = vi.mocked(runSessionBootstrapTransition);
const authority = vi.mocked(ensureRendererSessionCreationAuthority);
const scope = { teamId: "team", projectId: "project" };
beforeEach(() => {
  vi.restoreAllMocks();
  bootstrap.mockReset().mockResolvedValue(true);
  authority.mockReset().mockResolvedValue(undefined);
  rendererWorkbenchStore.getState().reset();
  useTaskDraftStore.getState().dispose();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  rendererWorkbenchStore.getState().registerWorkspace(workspaceDescriptorFixture("workspace-a", "/work/a", "filesystem"));
  useAppStore.setState({ workspace: "/work/a", trust: "trusted", connected: true, hostEpoch: 7,
    connectionIdentity: workspaceConnectionIdentity(7) });
});

it("creates a separate team Task and sends only explicit scope, preserving the private draft", async () => {
  const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);
  const privateId = beginRendererSessionIntent()!;
  useTaskDraftStore.getState().setText(privateId, "private draft");
  await createRendererSession({ teamScope: { ...scope, userId: "not-authority" } as typeof scope });
  const tasks = Object.values(rendererWorkbenchStore.getState().tasks);
  const team = tasks.find((task) => task.id !== privateId)!;
  expect(tasks).toHaveLength(2);
  expect(useTaskDraftStore.getState().drafts[privateId]?.text).toBe("private draft");
  expect(useTaskDraftStore.getState().drafts[team.id]?.text ?? "").toBe("");
  await bootstrap.mock.calls[0]![2].request();
  expect(request).toHaveBeenCalledExactlyOnceWith("session.create", { creationId: team.creationId, teamScope: scope }, [],
    expect.objectContaining({ context: expect.objectContaining({ taskId: team.id }) }));
});

it("captures scope before asynchronous connection recovery and ignores later caller mutation", async () => {
  const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);
  let release!: () => void;
  authority.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
  const selected = { ...scope };
  const pending = createRendererSession({ teamScope: selected });
  selected.teamId = "other-team"; selected.projectId = "other-project";
  release(); await pending;
  await bootstrap.mock.calls[0]![2].request();
  expect(request.mock.calls[0]?.[1]).toMatchObject({ teamScope: scope });
});

it("does not fall back to private creation after team authorization is rejected", async () => {
  const request = vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("team access denied"));
  bootstrap.mockImplementation(async (_get, _set, options) => {
    try { await options.request(); } catch (error) { options.onError(error); }
    return false;
  });
  await createRendererSession({ teamScope: scope });
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]?.[1]).toMatchObject({ teamScope: scope });
  expect(rendererWorkbenchStore.getState().tasks).toEqual({});
  expect(useNotificationStore.getState().items.at(-1)?.message).toBe("team access denied");
});

it("does not create in a different Workspace after connection recovery", async () => {
  let release!: () => void;
  authority.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
  const pending = createRendererSession({ teamScope: scope });
  useAppStore.setState({ workspace: "/other" });
  release(); await pending;
  expect(bootstrap).not.toHaveBeenCalled();
  expect(rendererWorkbenchStore.getState().tasks).toEqual({});
});

it("keeps one unconfirmed team creation and blocks a second scope after ambiguous acknowledgement", async () => {
  vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("resolver unavailable"));
  await createRendererSession({ teamScope: scope });
  bootstrap.mock.calls[0]![2].onError(new ProtocolRequestError({ code: "REQUEST_OUTCOME_UNKNOWN", message: "unknown", recoverable: true }));
  await createRendererSession({ teamScope: { teamId: "other", projectId: "other" } });
  expect(bootstrap).toHaveBeenCalledOnce();
  expect(Object.values(rendererWorkbenchStore.getState().tasks)).toHaveLength(1);
  expect(Object.values(rendererWorkbenchStore.getState().tasks)[0]?.creationStatus).toBe("unconfirmed");
});

it("reuses an empty intent only within the same private or team scope", () => {
  const privateId = beginRendererSessionIntent();
  const teamId = beginRendererSessionIntent(undefined, { teamScope: scope });
  expect(teamId).not.toBe(privateId);
  expect(beginRendererSessionIntent(undefined, { teamScope: { ...scope } })).toBe(teamId);
  expect(beginRendererSessionIntent()).not.toBe(teamId);
});

it("roundtrips team intent through Main validation and restored first-send creation", async () => {
  const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);
  const id = beginRendererSessionIntent(undefined, { teamScope: scope })!;
  useTaskDraftStore.getState().setText(id, "team draft");
  const stored = parseComposerDraftPersistedState(serializeTaskDraftState(100))!;
  expect(stored.drafts[0]?.teamScope).toEqual(scope);
  rendererWorkbenchStore.getState().reset(); useTaskDraftStore.getState().dispose();
  rendererWorkbenchStore.getState().registerWorkspace(workspaceDescriptorFixture("workspace-a", "/work/a", "filesystem"));
  restorePersistedDrafts(stored);
  expect(rendererWorkbenchStore.getState().tasks[id]?.teamScope).toEqual(scope);
  expect(useTaskDraftStore.getState().drafts[id]?.text).toBe("team draft");
  await materializeRendererSessionIntent(id);
  await bootstrap.mock.calls[0]![2].request();
  expect(request.mock.calls[0]?.[1]).toMatchObject({ teamScope: scope });
  rendererWorkbenchStore.getState().updateTask(id, { conversation: { kind: "session", workspaceId: "workspace-a",
    sessionFileIdentity: "file-team", sessionPath: "/sessions/team.jsonl" } });
  expect(serializeTaskDraftState(101).drafts[0]?.teamScope).toBeUndefined();
});

it("preserves a changed scope against stale recovery and rejects scope drift during creation", async () => {
  const id = beginRendererSessionIntent(undefined, { teamScope: scope })!;
  useTaskDraftStore.getState().setText(id, "draft");
  const stored = serializeTaskDraftState(100);
  rendererWorkbenchStore.getState().updateTask(id, { teamScope: { ...scope, projectId: "other" } });
  expect(serializeTaskDraftState(101).drafts[0]?.updatedAt).toBe(101);
  restorePersistedDrafts(stored);
  expect(rendererWorkbenchStore.getState().tasks[id]?.teamScope?.projectId).toBe("other");
  let release!: () => void;
  authority.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
  const pending = materializeRendererSessionIntent(id);
  rendererWorkbenchStore.getState().updateTask(id, { teamScope: undefined });
  release(); expect((await pending).status).toBe("failed");
  expect(bootstrap).not.toHaveBeenCalled();
});

it("retains team intent when immediate creation fails after draft input", async () => {
  await createRendererSession({ teamScope: scope });
  const task = Object.values(rendererWorkbenchStore.getState().tasks)[0]!;
  useTaskDraftStore.getState().setText(task.id, "retry team draft");
  bootstrap.mock.calls[0]![2].onError(new Error("team access denied"));
  expect(serializeTaskDraftState(100).drafts[0]?.teamScope).toEqual(scope);
  expect(rendererWorkbenchStore.getState().tasks[task.id]?.creationStatus).toBeUndefined();
});
