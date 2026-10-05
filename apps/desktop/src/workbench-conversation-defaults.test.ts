import { afterEach, expect, it } from "vitest";
import { parseWorkbenchStateV5 } from "./workbench-state-contract.js";
import { addOrRefreshWorkspace, removeWorkspaceRegistration, replaceWorkbenchLayout } from "./workbench-state.js";
import { cleanupWorkbenchStateTestRoots, temporaryWorkbenchStateRoot, workbenchDescriptorFixture,
  workbenchStateTestStore } from "./workbench-state-test-fixture.js";
import { parseWorkspaceConversationDefaults } from "./workbench-conversation-defaults.js";

afterEach(cleanupWorkbenchStateTestRoots);
const choice = { kind: "team" as const, teamId: "team", projectId: "project", teamName: "团队", projectName: "项目", userId: "user", serviceEndpoint: "https://newmoney.example" };

it("persists explicit defaults through Main disk reload and drops them only with their Workspace", async () => {
  const root = await temporaryWorkbenchStateRoot();
  const store = workbenchStateTestStore(root);
  let state = await store.update(state => addOrRefreshWorkspace(state, workbenchDescriptorFixture("w", `${root}/w`)).state);
  expect(state.conversationDefaults).toBeUndefined();
  state = await store.update(state => replaceWorkbenchLayout(state, { expandedWorkspaceIds: [], runtimeRecovery: [], sessionCreationRecovery: [],
    settings: state.settings, conversationDefaults: [{ workspaceId: "w", choice }] }));
  expect((await workbenchStateTestStore(root).load()).state.conversationDefaults).toEqual([{ workspaceId: "w", choice }]);
  expect(removeWorkspaceRegistration(state, "w").conversationDefaults).toEqual([]);
  expect(parseWorkbenchStateV5({ ...state, conversationDefaults: [{ workspaceId: "foreign", choice }] })).toBeUndefined();
});

it("rejects ambiguous defaults, secret-bearing endpoints, malformed identities and extra fields", () => {
  const ids = new Set(["w"]);
  expect(parseWorkspaceConversationDefaults([{ workspaceId: "w", choice: { kind: "private" } }], ids)).toHaveLength(1);
  for (const value of [
    [{ workspaceId: "w", choice }, { workspaceId: "w", choice }],
    [{ workspaceId: "w", choice: { ...choice, serviceEndpoint: "https://user:secret@example.com" } }],
    [{ workspaceId: "w", choice: { ...choice, userId: "" } }],
    [{ workspaceId: "w", choice: { ...choice, teamId: "bad id" } }],
    [{ workspaceId: "w", choice: { kind: "private", teamId: "team" } }],
    [{ workspaceId: "w", choice, unexpected: true }]
  ]) expect(parseWorkspaceConversationDefaults(value, ids)).toBeUndefined();
});
