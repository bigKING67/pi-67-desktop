import { expect, it } from "vitest";
import { parseComposerDraftPersistedState } from "./composer-draft-state.js";

const draft = { conversation: { kind: "provisional", workspaceId: "workspace", draftId: "draft" },
  text: "team fixture", streamBehavior: "followUp", updatedAt: 1 };
const scope = { teamId: "team", projectId: "project" };
it("accepts team intent without treating it as an authorization grant", () => {
  const value = { version: 1, drafts: [{ ...draft, teamScope: scope }] };
  expect(parseComposerDraftPersistedState(value)).toEqual(value);
  expect(parseComposerDraftPersistedState({ version: 1, drafts: [draft] })?.drafts[0]?.teamScope).toBeUndefined();
});
it.each([null, {}, { teamId: "team" }, { ...scope, userId: "user" }, { ...scope, endpoint: "https://server.invalid" },
  { ...scope, teamId: "" }, { ...scope, teamId: "a".repeat(129) }, { ...scope, projectId: "white space" },
  { ...scope, projectId: "bad\0id" }])("rejects malformed or identity-bearing scope %# without converting it to private", (teamScope) => {
  expect(parseComposerDraftPersistedState({ version: 1, drafts: [{ ...draft, teamScope }] })).toBeUndefined();
});
it("rejects draft scope on a materialized Session whose identity belongs to Pi JSONL", () => {
  expect(parseComposerDraftPersistedState({ version: 1, drafts: [{ ...draft, teamScope: scope,
    conversation: { kind: "session", workspaceId: "workspace", sessionFileIdentity: "file", sessionPath: "/sessions/fixture.jsonl" } }] })).toBeUndefined();
});
