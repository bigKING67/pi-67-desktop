import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { projectSessionMemoryOrigin } from "./session-memory-origin.js";
import { initializePrivateMemoryProvenance, markSharedMemoryProvenance } from "./session-memory-provenance.js";
import { markTeamSessionBirth } from "./team-session-birth.js";

it("does not certify unmarked legacy history or mutate it", () => {
  const manager = SessionManager.inMemory("/workspace");
  manager.appendMessage({ role: "user", content: "legacy", timestamp: 1 });
  const before = manager.getEntries();
  expect(projectSessionMemoryOrigin(manager)).toEqual({ kind: "unverified" });
  expect(manager.getEntries()).toEqual(before);
});

it("projects verified private and rejects shared history on inactive branches", () => {
  const manager = SessionManager.inMemory("/workspace");
  initializePrivateMemoryProvenance(manager);
  expect(projectSessionMemoryOrigin(manager)).toEqual({ kind: "private" });
  const leaf = manager.getLeafId()!;
  manager.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "viking_sop_read",
    content: [{ type: "text", text: "shared" }], isError: false, timestamp: 1 });
  manager.branch(leaf);
  expect(projectSessionMemoryOrigin(manager)).toEqual({ kind: "unverified" });
});

it.each(["private", "team"])("does not certify inherited %s provenance", (kind) => {
  const manager = SessionManager.inMemory("/workspace");
  if (kind === "private") initializePrivateMemoryProvenance(manager);
  else markTeamSessionBirth(manager, { userId: "user", teamId: "team", projectId: "project", endpoint: "https://service.fixture/" });
  const header = manager.getHeader()!;
  vi.spyOn(manager, "getHeader").mockReturnValue({ ...header, parentSession: "/other.jsonl" });
  expect(projectSessionMemoryOrigin(manager)).toEqual({ kind: "unverified" });
});

it("projects only birth-bound scope without credential identity or permission", () => {
  const manager = SessionManager.inMemory("/workspace");
  markTeamSessionBirth(manager, { userId: "user", teamId: "team", projectId: "project", endpoint: "https://service.fixture/" });
  expect(projectSessionMemoryOrigin(manager)).toEqual({ kind: "team", teamId: "team", projectId: "project" });
  markSharedMemoryProvenance(manager);
  expect(projectSessionMemoryOrigin(manager)).toEqual({ kind: "unverified" });
});

it.each([null, { version: 2, kind: "private" }, { version: 1, kind: "private", originSessionId: "other" },
  { version: 1, kind: "team", teamId: "team" }])("projects malformed provenance as unverified %#", (data) => {
  const manager = SessionManager.inMemory("/workspace");
  manager.appendCustomEntry("pi67.memory-provenance.v1", data);
  expect(projectSessionMemoryOrigin(manager)).toEqual({ kind: "unverified" });
});
