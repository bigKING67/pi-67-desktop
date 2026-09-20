import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { assertPrivateMemoryProvenance, initializePrivateMemoryProvenance, markSharedMemoryProvenance } from "./session-memory-provenance.js";
import { createSessionSharedKnowledgeTools } from "./session-shared-knowledge-tools.js";
import { markTeamSessionBirth } from "./team-session-birth.js";

it("initializes a fresh Session exactly once and keeps Pi as the provenance authority", () => {
  const manager = SessionManager.inMemory("/workspace");
  initializePrivateMemoryProvenance(manager);
  initializePrivateMemoryProvenance(manager);
  expect(manager.getEntries()).toHaveLength(1);
  expect(() => assertPrivateMemoryProvenance(manager)).not.toThrow();
});

it("retains shared provenance when the active branch moves before the shared attempt", () => {
  const manager = SessionManager.inMemory("/workspace");
  initializePrivateMemoryProvenance(manager);
  const privateLeaf = manager.getLeafId()!;
  markSharedMemoryProvenance(manager);
  manager.branch(privateLeaf);
  initializePrivateMemoryProvenance(manager);
  expect(() => assertPrivateMemoryProvenance(manager)).toThrow("Shared or unverified");
  markSharedMemoryProvenance(manager);
  expect(manager.getEntries()).toHaveLength(2);
});

it("does not adopt older message history as private", () => {
  const manager = SessionManager.inMemory("/workspace");
  manager.appendMessage({ role: "user", content: "historical context", timestamp: 1 });
  initializePrivateMemoryProvenance(manager);
  expect(manager.getEntries()).toHaveLength(1);
  expect(() => assertPrivateMemoryProvenance(manager)).toThrow();
});

it.each([null, { version: 2, kind: "private" }, { version: 1, kind: "private", originSessionId: "other" },
  { version: 1, kind: "team", teamId: "unverified" }])("rejects malformed or unverified provenance %#", (data) => {
  const manager = SessionManager.inMemory("/workspace");
  manager.appendCustomEntry("pi67.memory-provenance.v1", data);
  initializePrivateMemoryProvenance(manager);
  expect(() => assertPrivateMemoryProvenance(manager)).toThrow();
});

it("rejects shared Tool history even if a private marker precedes it", () => {
  const manager = SessionManager.inMemory("/workspace");
  initializePrivateMemoryProvenance(manager);
  manager.appendMessage({ role: "toolResult", toolCallId: "shared", toolName: "viking_sop_read",
    content: [{ type: "text", text: "shared" }], isError: false, timestamp: 1 });
  expect(() => assertPrivateMemoryProvenance(manager)).toThrow();
});

it("retains team provenance during failed shared searches without adding an unverified marker", async () => {
  const manager = SessionManager.inMemory("/workspace");
  const scope = { userId: "user", teamId: "team", projectId: "project", endpoint: "https://server.fixture/" };
  markTeamSessionBirth(manager, scope);
  const search = vi.fn(async () => {
    expect(() => assertPrivateMemoryProvenance(manager)).toThrow();
    throw new Error("synthetic network failure");
  });
  const tools = createSessionSharedKnowledgeTools({ search, read: vi.fn() }, undefined, () => manager);
  await expect(tools[0]!.execute("call", { query: "query" }, undefined, undefined,
    { sessionManager: manager, model: { baseUrl: "https://model.fixture", id: "model" } } as never)).rejects.toThrow("synthetic network failure");
  expect(search).toHaveBeenCalledOnce();
  expect(search).toHaveBeenCalledWith("query", 2, undefined, { baseUrl: "https://model.fixture", id: "model", scope });
  expect(manager.getEntries()).toHaveLength(1);
  expect(() => assertPrivateMemoryProvenance(manager)).toThrow();
});

it("rejects private Sessions before shared transport and retains the conservative attempted-shared boundary", () => {
  const manager = SessionManager.inMemory("/workspace");
  initializePrivateMemoryProvenance(manager);
  const search = vi.fn();
  const tools = createSessionSharedKnowledgeTools({ search, read: vi.fn() }, undefined, () => manager);
  expect(() => tools[0]!.execute("call", { query: "query" }, undefined, undefined,
    { sessionManager: manager } as never)).toThrow("birth-bound team");
  expect(search).not.toHaveBeenCalled();
  expect(() => assertPrivateMemoryProvenance(manager)).toThrow();
});

it("rejects mismatched Session ownership before any mutation or transport", () => {
  const manager = SessionManager.inMemory("/workspace"), other = SessionManager.inMemory("/workspace");
  const search = vi.fn();
  const tools = createSessionSharedKnowledgeTools({ search, read: vi.fn() }, undefined, () => manager);
  expect(() => tools[0]!.execute("call", { query: "query" }, undefined, undefined,
    { sessionManager: other } as never)).toThrow("active Pi Session");
  expect(manager.getEntries()).toHaveLength(0);
  expect(search).not.toHaveBeenCalled();
});

it("retains the restriction after JSONL reopen and a fork before shared admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-memory-provenance-"));
  try {
    const manager = SessionManager.inMemory(root);
    initializePrivateMemoryProvenance(manager);
    manager.appendMessage({ role: "user", content: "private starting point", timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "synthetic response" }],
      api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: 2,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const privateLeaf = manager.getLeafId()!;
    markSharedMemoryProvenance(manager);
    const path = join(root, "session.jsonl");
    await writeFile(path, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const reopened = SessionManager.open(path, root);
    expect(() => assertPrivateMemoryProvenance(reopened)).toThrow();
    const forkPath = reopened.createBranchedSession(privateLeaf);
    expect(forkPath).toBeTypeOf("string");
    const fork = SessionManager.open(forkPath!, root);
    initializePrivateMemoryProvenance(fork);
    expect(() => assertPrivateMemoryProvenance(fork)).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
