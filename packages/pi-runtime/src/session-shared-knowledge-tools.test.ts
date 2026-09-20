import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { createSessionSharedKnowledgeTools } from "./session-shared-knowledge-tools.js";
import type { SharedExperienceAccess } from "./shared-experience-tools.js";
import { markTeamSessionBirth } from "./team-session-birth.js";

const scope = { userId: "user", teamId: "team", projectId: "project", endpoint: "https://server.fixture/" };
const item = { id: "asset", projectId: "project", externalRevision: "a".repeat(64), title: "Synthetic",
  taskType: "test", summary: "Synthetic summary", score: 1, applicableWhen: [], notApplicableWhen: [], publishedAt: 1 };
const result = { items: [item], total: 1 };
const detail: Awaited<ReturnType<SharedExperienceAccess["read"]>> = { ...item,
  problem: "Synthetic problem", strategy: "Synthetic strategy", result: "success", confidence: 1, sensitivity: "team",
  method: { preconditions: [], steps: [], tools: [], validationGates: [], completionCriteria: [], failureModes: [], rollback: "None" }, evidence: [] };

it("selects only local team tools when both local and legacy ports are supplied", async () => {
  const manager = SessionManager.inMemory("/synthetic-workspace");
  markTeamSessionBirth(manager, scope);
  const legacy = { search: vi.fn(), read: vi.fn() };
  const local = { search: vi.fn().mockRejectedValue(new Error("local index unavailable")), read: vi.fn() };
  const tools = createSessionSharedKnowledgeTools(legacy, legacy, () => manager, local);
  expect(tools.map(tool => tool.name)).toEqual(["viking_team_search", "viking_team_read"]);
  const context = { sessionManager: manager, model: { baseUrl: "https://model.fixture", id: "model" } } as unknown as ExtensionContext;
  await expect(tools[0]!.execute("local", { query: "synthetic", scope: "project" }, undefined, undefined, context))
    .rejects.toThrow("local index unavailable");
  expect(local.search).toHaveBeenCalledOnce();
  expect(legacy.search).not.toHaveBeenCalled();
  expect(legacy.read).not.toHaveBeenCalled();
  expect(tools.map(tool => tool.name)).toEqual(["viking_team_search", "viking_team_read"]);
});

it("retains the legacy tool set only when no local team port is selected", () => {
  const legacy = { search: vi.fn(), read: vi.fn() };
  expect(createSessionSharedKnowledgeTools(legacy, legacy, () => undefined).map(tool => tool.name))
    .toEqual(["viking_shared_search", "viking_shared_read", "viking_sop_search", "viking_sop_read"]);
  expect(createSessionSharedKnowledgeTools(undefined, undefined, () => undefined)).toEqual([]);
});

function fixture() {
  const manager = SessionManager.inMemory("/synthetic-workspace");
  markTeamSessionBirth(manager, scope);
  let current: SessionManager | undefined = manager;
  const context = { sessionManager: manager, model: { baseUrl: "https://model.fixture", id: "model" } } as unknown as ExtensionContext;
  const search = vi.fn<SharedExperienceAccess["search"]>().mockResolvedValue(result);
  const read = vi.fn<SharedExperienceAccess["read"]>().mockResolvedValue(detail);
  const tools = createSessionSharedKnowledgeTools({ search, read }, undefined, () => current);
  const execute = (name: string, input: unknown, signal?: AbortSignal) => tools.find((tool) => tool.name === name)!
    .execute("synthetic-call", input, signal, undefined, context);
  return { manager, context, search, read, setManager: (value: SessionManager | undefined) => { current = value; },
    select: (signal?: AbortSignal) => execute("viking_shared_search", { query: "synthetic" }, signal),
    load: (signal?: AbortSignal) => execute("viking_shared_read", { id: item.id }, signal) };
}

it("keeps authorized search and exact-version read details unchanged", async () => {
  const f = fixture();
  await expect(f.select()).resolves.toMatchObject({ details: { items: [item], trust: "untrusted" } });
  await expect(f.load()).resolves.toMatchObject({ details: { item: detail, provider: "openviking-enterprise" } });
  expect(f.read).toHaveBeenCalledWith(item.id, undefined, { ...f.context.model, scope });
});

it.each(["search", "read"] as const)("withholds a late %s when the active manager is removed", async (operation) => {
  const f = fixture();
  await f.select();
  const pending = Promise.withResolvers<never>();
  if (operation === "search") f.search.mockImplementationOnce(() => pending.promise);
  else f.read.mockImplementationOnce(() => pending.promise);
  const running = operation === "search" ? f.select() : f.load();
  f.setManager(undefined);
  pending.resolve((operation === "search" ? result : detail) as never);
  await expect(running).rejects.toThrow("Session or model changed");
  f.setManager(f.manager);
  await expect(f.load()).rejects.toThrow("Search shared");
  await f.select();
  await expect(f.load()).resolves.toMatchObject({ details: { item: detail } });
});

it.each(["userId", "teamId", "projectId", "endpoint"] as const)("rejects a late body after birth %s drift", async (field) => {
  const f = fixture();
  await f.select();
  const pending = Promise.withResolvers<typeof detail>();
  f.read.mockImplementationOnce(() => pending.promise);
  const running = f.load();
  const entries = f.manager.getEntries().map((entry) => entry.type === "custom"
    ? { ...entry, data: { ...entry.data as object, [field]: field === "endpoint" ? "https://other.fixture/" : "other" } } : entry);
  const spy = vi.spyOn(f.manager, "getEntries").mockReturnValue(entries);
  pending.resolve(detail);
  await expect(running).rejects.toThrow("Session or model changed");
  spy.mockRestore();
  await expect(f.load()).rejects.toThrow("Search shared");
});

it.each(["baseUrl", "id", "missing"] as const)("rejects a late search after request model %s changes", async (field) => {
  const f = fixture(), pending = Promise.withResolvers<typeof result>();
  f.search.mockImplementationOnce(() => pending.promise);
  const running = f.select(), original = f.context.model;
  f.context.model = field === "missing" ? undefined : { ...original!, [field]: "changed" };
  pending.resolve(result);
  await expect(running).rejects.toThrow("Session or model changed");
  f.context.model = original;
  await expect(f.load()).rejects.toThrow("Search shared");
  expect(f.read).not.toHaveBeenCalled();
});

it("does not reuse search selection when a different manager reopens the same Session ID", async () => {
  const f = fixture();
  await f.select();
  const replacement = SessionManager.inMemory("/synthetic-workspace");
  vi.spyOn(replacement, "getSessionId").mockReturnValue(f.manager.getSessionId());
  markTeamSessionBirth(replacement, scope);
  f.setManager(replacement);
  await expect(f.load()).rejects.toThrow("Search shared");
  expect(f.read).not.toHaveBeenCalled();
  await f.select();
  await expect(f.load()).resolves.toMatchObject({ details: { item: detail } });
});

it("does not let an older completion clear a newly admitted manager's selection", async () => {
  const f = fixture(), pending = Promise.withResolvers<typeof result>();
  f.search.mockImplementationOnce(() => pending.promise);
  const old = f.select();
  const replacement = SessionManager.inMemory("/synthetic-workspace");
  vi.spyOn(replacement, "getSessionId").mockReturnValue(f.manager.getSessionId());
  markTeamSessionBirth(replacement, scope);
  f.setManager(replacement);
  await f.select();
  pending.resolve(result);
  await expect(old).rejects.toThrow("Session or model changed");
  await expect(f.load()).resolves.toMatchObject({ details: { item: detail } });
});

it("drops prior selection after caller cancellation even if the transport settles successfully", async () => {
  const f = fixture(), controller = new AbortController(), pending = Promise.withResolvers<typeof detail>();
  await f.select();
  f.read.mockImplementationOnce(() => pending.promise);
  const running = f.load(controller.signal);
  controller.abort(); pending.resolve(detail);
  await expect(running).rejects.toThrow();
  await expect(f.load()).rejects.toThrow("Search shared");
});

it("withholds results when full-history provenance becomes invalid during access", async () => {
  const f = fixture(), pending = Promise.withResolvers<typeof result>();
  f.search.mockImplementationOnce(() => pending.promise);
  const running = f.select();
  f.manager.appendCustomEntry("pi67.memory-provenance.v1", { kind: "private" });
  pending.resolve(result);
  await expect(running).rejects.toThrow("birth-bound team");
});

it("applies the same completion boundary to SOP tools", async () => {
  const f = fixture(), pending = Promise.withResolvers<{ items: []; total: number }>();
  const search = vi.fn(() => pending.promise);
  const tools = createSessionSharedKnowledgeTools(undefined, { search, read: vi.fn() }, () => f.manager);
  const running = tools[0]!.execute("sop", { query: "synthetic" }, undefined, undefined, f.context);
  f.context.model = undefined;
  pending.resolve({ items: [], total: 0 });
  await expect(running).rejects.toThrow("Session or model changed");
  expect(search).toHaveBeenCalledOnce();
});
