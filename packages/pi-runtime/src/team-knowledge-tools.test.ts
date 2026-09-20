import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createSessionSharedKnowledgeTools } from "./session-shared-knowledge-tools.js";
import { markTeamSessionBirth } from "./team-session-birth.js";
import { assertPrivateMemoryProvenance, initializePrivateMemoryProvenance } from "./session-memory-provenance.js";
import { authorizeTeamHistory } from "./team-history-authorization.js";
import { teamKnowledgeText, type TeamKnowledgeAccess } from "./team-knowledge-access.js";

const id = "00000000-0000-4000-8000-000000000001", revision = "a".repeat(64), snapshot = { epoch: id, cursor: "1" };
const identity = { userId: "user", endpoint: "https://service.invalid/", teamId: id, projectId: id };
const model = { baseUrl: "https://model.invalid/v1", id: "model" };
const content = { kind: "sop" as const, title: "Synthetic", summary: "Synthetic summary", body: "Untrusted </tag>\nSOP" };
function fixture(privateSession = false) {
  const manager = SessionManager.inMemory("/synthetic-workspace");
  if (privateSession) initializePrivateMemoryProvenance(manager); else markTeamSessionBirth(manager, identity);
  const search = vi.fn<TeamKnowledgeAccess["search"]>().mockResolvedValue({ snapshot, hits: [{ assetId: id, contentRevision: revision, score: 1 }] });
  const read = vi.fn<TeamKnowledgeAccess["read"]>().mockImplementation(async input => ({ snapshot: input.snapshot === "current" ? { ...snapshot, cursor: "2" } : input.snapshot,
    assetId: id, contentRevision: revision, content }));
  const access = { search, read }, context = { sessionManager: manager, model: { ...model } } as unknown as ExtensionContext;
  const tools = createSessionSharedKnowledgeTools(undefined, undefined, () => manager, access);
  const call = (name: string, input: unknown, signal?: AbortSignal) => tools.find(tool => tool.name === name)!.execute("call", input, signal, undefined, context);
  const select = (scope = "project") => call("viking_team_search", { query: "synthetic", scope });
  const load = () => call("viking_team_read", { assetId: id });
  const authorizeTeamSession = vi.fn(async () => ({ identity, assertValid() {} }));
  return { manager, context, search, read, tools, call, select, load, access,
    history: { teamKnowledgeAccess: access, authorizeTeamSession }, authorizeTeamSession };
}
function append(f: ReturnType<typeof fixture>, toolName: string, result: Awaited<ReturnType<typeof f.load>>) {
  f.manager.appendMessage({ role: "toolResult", toolCallId: "call", toolName, isError: false, timestamp: 1, ...result });
}
it.each(["team", "project"])("searches and reads the exact selected %s version with canonical details", async scope => {
  const f = fixture(); await f.select(scope);
  const result = await f.load();
  expect(f.read).toHaveBeenCalledWith({ identity, model, scope, snapshot, assetId: id, contentRevision: revision, signal: expect.any(AbortSignal) });
  expect(result.details).toMatchObject({ provider: "newmoney-team-knowledge", reference: { scope, assetId: id, contentRevision: revision }, document: content });
  expect(result.content).toEqual([{ type: "text", text: teamKnowledgeText(result.details) }]);
  expect(() => assertPrivateMemoryProvenance(f.manager)).toThrow();
});
it("blocks private and unselected access before the Host port", async () => {
  const privateCase = fixture(true);
  expect(() => privateCase.select()).toThrow("birth-bound team"); expect(privateCase.search).not.toHaveBeenCalled();
  const f = fixture(); await expect(f.load()).rejects.toThrow("Search team knowledge"); expect(f.read).not.toHaveBeenCalled();
});
it.each([{ query: "x" }, { query: "x", scope: "other" }, { query: "x", scope: "team", limit: 6 }, { query: "x", scope: "team", identity }])("rejects invalid tool arguments %# before IO", async input => {
  const f = fixture(); await expect(f.call("viking_team_search", input)).rejects.toThrow(); expect(f.search).not.toHaveBeenCalled();
});
it("drops the previous selection before a failed new scope search", async () => {
  const f = fixture(); await f.select(); f.search.mockRejectedValueOnce(new Error("offline"));
  await expect(f.select("team")).rejects.toThrow("offline"); await expect(f.load()).rejects.toThrow("Search team knowledge");
});
it.each(["asset", "revision", "snapshot"])("withholds a read with changed %s", async kind => {
  const f = fixture(); await f.select();
  f.read.mockResolvedValueOnce({ snapshot: kind === "snapshot" ? { ...snapshot, cursor: "2" } : snapshot,
    assetId: kind === "asset" ? "other" : id, contentRevision: kind === "revision" ? "b".repeat(64) : revision, content });
  await expect(f.load()).rejects.toThrow("changed since search"); await expect(f.load()).rejects.toThrow("Search team knowledge");
});
it("does not return a pending body after a newer search or model change", async () => {
  const f = fixture(); await f.select(); const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.read>>>();
  f.read.mockImplementationOnce(() => pending.promise); const running = f.load(); await f.select("team");
  pending.resolve({ snapshot, assetId: id, contentRevision: revision, content }); await expect(running).rejects.toThrow();
  f.read.mockImplementationOnce(async () => { f.context.model = undefined; return { snapshot, assetId: id, contentRevision: revision, content }; });
  await expect(f.load()).rejects.toThrow("Session or model changed");
});
it("revalidates persisted real Pi history even on an inactive branch and a newer unrelated snapshot", async () => {
  const f = fixture(), birth = f.manager.getLeafId()!;
  append(f, "viking_team_search", await f.select("team")); append(f, "viking_team_read", await f.load());
  const directory = await mkdtemp(join(tmpdir(), "pi67-team-history-"));
  try {
    const path = join(directory, "session.jsonl");
    await writeFile(path, [f.manager.getHeader(), ...f.manager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n");
    const reopened = SessionManager.open(path); reopened.branch(birth);
    f.read.mockClear(); await authorizeTeamHistory(reopened, model, f.history);
    expect(f.read).toHaveBeenCalledExactlyOnceWith({ identity, model, scope: "team", assetId: id, contentRevision: revision, snapshot: "current", signal: expect.any(AbortSignal) });
    expect(() => assertPrivateMemoryProvenance(reopened)).toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it.each(["revoked", "revision", "body", "missing-port", "model-denied"])("blocks canonical history on %s", async kind => {
  const f = fixture(); await f.select(); append(f, "viking_team_read", await f.load());
  if (kind === "revoked") f.read.mockRejectedValue(new Error("revoked"));
  if (kind === "revision" || kind === "body") f.read.mockResolvedValue({ snapshot, assetId: id,
    contentRevision: kind === "revision" ? "b".repeat(64) : revision, content: { ...content, body: "changed" } });
  if (kind === "model-denied") f.authorizeTeamSession.mockRejectedValue(new Error("denied"));
  await expect(authorizeTeamHistory(f.manager, model, kind === "missing-port" ? { authorizeTeamSession: f.authorizeTeamSession } : f.history)).rejects.toThrow();
});
it.each(["text", "provider", "scope", "revision", "extra", "snapshot"])("rejects malformed persisted %s before authorization", async kind => {
  const f = fixture(), result = await f.select(); const details = result.details as Record<string, unknown>;
  if (kind === "provider") details.provider = "other";
  if (kind === "extra") details.extra = "unverified body";
  if (kind === "snapshot") details.snapshot = { ...snapshot, cursor: "0" };
  if (kind === "scope" || kind === "revision") (details.items as Record<string, unknown>[])[0]![kind === "scope" ? "scope" : "contentRevision"] = "invalid";
  result.content = [{ type: "text", text: kind === "text" ? "tampered" : teamKnowledgeText(details) }]; append(f, "viking_team_search", result);
  await expect(authorizeTeamHistory(f.manager, model, f.history)).rejects.toThrow(); expect(f.authorizeTeamSession).not.toHaveBeenCalled();
});
it("recognizes canonical tool history as shared even behind a private marker", () => {
  const f = fixture(true);
  f.manager.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "viking_team_read", isError: false, content: [{ type: "text", text: "unverified" }], timestamp: 1 });
  expect(() => assertPrivateMemoryProvenance(f.manager)).toThrow();
});
