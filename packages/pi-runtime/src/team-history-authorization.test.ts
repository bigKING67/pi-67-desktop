import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { authorizeTeamHistory } from "./team-history-authorization.js";
import { markTeamSessionBirth } from "./team-session-birth.js";

const identity = { userId: "user", teamId: "team", projectId: "project", endpoint: "https://fixture.invalid/" };
const model = { baseUrl: "https://model.invalid", id: "fixture" };
const item = { id: "asset", projectId: "project", externalRevision: "a".repeat(64) };
afterEach(() => vi.restoreAllMocks());
function fixture(manager = SessionManager.inMemory("/workspace")) {
  markTeamSessionBirth(manager, identity);
  const assertValid = vi.fn();
  const authorizeTeamSession = vi.fn(async () => ({ identity, assertValid }));
  const read = vi.fn(async () => ({ ...item }) as never);
  return { manager, assertValid, authorizeTeamSession, read,
    access: { authorizeTeamSession, sharedExperienceAccess: { read, search: vi.fn() }, sharedSopAccess: { read, search: vi.fn() } } };
}
function append(manager: SessionManager, toolName = "viking_shared_search", patch: Record<string, unknown> = {}) {
  return manager.appendMessage({ role: "toolResult", toolCallId: "call", toolName, isError: false, timestamp: 1,
    content: [{ type: "text", text: "untrusted fixture" }],
    details: { provider: "openviking-enterprise", trust: "untrusted", count: 1, items: [item], item, ...patch } });
}

it("revalidates deduplicated references from real persisted Pi details, including inactive branches", async () => {
  const root = await mkdtemp(join(tmpdir(), "new-money-history-"));
  try {
    const f = fixture(SessionManager.create(root, root));
    const birth = f.manager.getLeafId()!;
    append(f.manager); append(f.manager, "viking_shared_read");
    // Pi flushes the initial buffered history after the first assistant message.
    f.manager.appendMessage({ role: "assistant", api: "openai-responses", provider: "fixture", model: "fixture", timestamp: 1,
      content: [{ type: "text", text: "fixture" }], stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const reopened = SessionManager.open(f.manager.getSessionFile()!);
    reopened.branch(birth);
    await authorizeTeamHistory(reopened, model, f.access);
    expect(f.read).toHaveBeenCalledExactlyOnceWith("asset", undefined, { ...model, scope: identity });
    expect(f.authorizeTeamSession).toHaveBeenCalledExactlyOnceWith(identity, model, undefined);
    f.read.mockResolvedValue({ ...item, externalRevision: "b".repeat(64) } as never);
    await expect(authorizeTeamHistory(reopened, model, f.access)).rejects.toThrow("authorized revision");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.each(["viking_shared_search", "viking_shared_read", "viking_sop_search", "viking_sop_read"])("checks %s revisions and propagates current access denial", async (tool) => {
  const f = fixture(); append(f.manager, tool);
  await authorizeTeamHistory(f.manager, model, f.access);
  f.read.mockRejectedValue(new Error("revoked"));
  await expect(authorizeTeamHistory(f.manager, model, f.access)).rejects.toThrow("revoked");
});

it.each([{ items: [{}] }, { items: [{ ...item, projectId: "other" }] }, { items: [{ ...item, externalRevision: "unknown" }] },
  { provider: "other" }, { count: 0 }, { items: undefined }])("rejects unverified persisted references before authorization %#", async (patch) => {
  const f = fixture(); append(f.manager, "viking_shared_search", patch);
  await expect(authorizeTeamHistory(f.manager, model, f.access)).rejects.toThrow();
  expect(f.authorizeTeamSession).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
});

it.each(["identity", "policy", "expiry", "history", "abort"])("rejects %s changes before transport admission", async (change) => {
  const f = fixture(); append(f.manager);
  const abort = new AbortController();
  if (change === "identity") f.authorizeTeamSession.mockResolvedValue({ identity: { ...identity, userId: "other" }, assertValid: f.assertValid });
  if (change === "policy") f.assertValid.mockImplementation(() => { throw new Error("policy denied"); });
  if (change === "expiry") f.read.mockResolvedValue({ ...item, expiresAt: Date.now() - 1 } as never);
  if (change === "history") f.read.mockImplementation(async () => { append(f.manager); return item as never; });
  if (change === "abort") f.read.mockImplementation(async () => { abort.abort(); return item as never; });
  await expect(authorizeTeamHistory(f.manager, model, f.access, abort.signal)).rejects.toThrow();
});

it("rejects derived history without original asset provenance", async () => {
  const f = fixture();
  f.manager.appendCustomMessageEntry("derived", "summary", true);
  await expect(authorizeTeamHistory(f.manager, model, f.access)).rejects.toThrow("derived content");
  expect(f.authorizeTeamSession).not.toHaveBeenCalled();
});

it("keeps the admitted grant and SOP expiry live for the running request", async () => {
  const f = fixture(); append(f.manager, "viking_sop_read");
  const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
  f.read.mockResolvedValue({ ...item, expiresAt: now + 1 } as never);
  const lease = await authorizeTeamHistory(f.manager, model, f.access);
  lease.assertValid();
  clock.mockReturnValue(now + 1);
  expect(() => lease.assertValid()).toThrow("SOP has expired");
  f.assertValid.mockImplementation(() => { throw new Error("signed out"); });
  expect(() => lease.assertValid()).toThrow("signed out");
});

it("renews only the admitted model basis while a newly requested shared Tool is unfinished", async () => {
  const f = fixture(); append(f.manager);
  const lease = await authorizeTeamHistory(f.manager, model, f.access);
  f.manager.appendMessage({ role: "assistant", api: "openai-responses", provider: "fixture", model: "fixture", timestamp: 1,
    content: [{ type: "toolCall", id: "pending", name: "viking_shared_read", arguments: { id: "next" } }], stopReason: "toolUse",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const refreshed = await lease.renewToolBasis(new AbortController().signal);
  refreshed.assertValid();
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.read).toHaveBeenNthCalledWith(2, "asset", expect.any(AbortSignal), { ...model, scope: identity });
  // Renewal does not grant permission to send an incomplete new history to a model.
  await expect(authorizeTeamHistory(f.manager, model, f.access)).rejects.toThrow("unresolved shared Tool");
  f.read.mockRejectedValue(new Error("basis asset revoked"));
  await expect(refreshed.renewToolBasis(new AbortController().signal)).rejects.toThrow("basis asset revoked");
});

it.each(["before", "during"])("rejects renewal after branching away from the admitted basis: %s", async (when) => {
  const f = fixture();
  const birth = f.manager.getLeafId()!;
  append(f.manager);
  const lease = await authorizeTeamHistory(f.manager, model, f.access);
  if (when === "before") f.manager.branch(birth);
  else f.read.mockImplementation(async () => { f.manager.branch(birth); return item as never; });
  await expect(lease.renewToolBasis(new AbortController().signal)).rejects.toThrow("history changed");
});
