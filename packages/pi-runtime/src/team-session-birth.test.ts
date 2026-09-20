import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import { markTeamSessionBirth, readTeamSessionIdentity } from "./team-session-birth.js";
import { assertPrivateMemoryProvenance, sharedHistoryNeedsAuthorization } from "./session-memory-provenance.js";
import type { RuntimeSessionBindings } from "./runtime-session-bindings.js";

const scope = { teamId: "team-fixture", projectId: "project-fixture" };
const identity = { ...scope, userId: "user-fixture", endpoint: "https://server.fixture" };
it("registers canonical tools through real Pi initial and replacement runtimes without calling the access port", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-team-tools-")), access = { search: vi.fn(), read: vi.fn() };
  const legacy = { search: vi.fn(), read: vi.fn() };
  const runtime = new PiSdkRuntime({ teamKnowledgeAccess: access, sharedExperienceAccess: legacy,
    sharedSopAccess: legacy, authorizeTeamSession: async () => ({ identity, assertValid() {} }) });
  try {
    await runtime.initialize({ cwd: root, agentDir: join(root, "agent"), trust: "unknown", approvalMode: "guided", creationId: "initial", teamScope: scope });
    const bindings = (runtime as unknown as { sessionBindings: RuntimeSessionBindings }).sessionBindings;
    for (const next of [false, true]) {
      if (next) await runtime.createSession("replacement", scope);
      const names = bindings.requireSession().agent.state.tools.map(tool => tool.name);
      expect(names).toContain("viking_team_search"); expect(names).toContain("viking_team_read");
      for (const name of ["viking_shared_search", "viking_shared_read", "viking_sop_search", "viking_sop_read"]) {
        expect(names).not.toContain(name);
      }
    }
    expect(access.search).not.toHaveBeenCalled(); expect(access.read).not.toHaveBeenCalled();
    expect(legacy.search).not.toHaveBeenCalled(); expect(legacy.read).not.toHaveBeenCalled();
  } finally { await runtime.dispose(); await rm(root, { recursive: true, force: true }); }
}, 15_000);
it.each([{ userId: "" }, { projectId: "bad scope" }, { endpoint: "https://user:secret@fixture.invalid" },
  { endpoint: "http://remote.invalid" }, { originSessionId: "other" }, { version: 2 }])("rejects malformed persisted team identity %#", (patch) => {
  const manager = SessionManager.inMemory("/workspace");
  manager.appendCustomEntry("pi67.memory-provenance.v1", { version: 1, kind: "team", originSessionId: manager.getSessionId(), ...identity, ...patch });
  expect(() => readTeamSessionIdentity(manager)).toThrow();
});
it("creates immutable team identity in both initial and subsequent real Pi JSONL Sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-team-birth-"));
  const assertValid = vi.fn();
  const authorizeTeamSession = vi.fn(async () => ({ identity, assertValid }));
  const runtime = new PiSdkRuntime({ authorizeTeamSession });
  try {
    const initial = await runtime.initialize({ cwd: root, agentDir: join(root, "agent"), trust: "unknown", approvalMode: "guided",
      creationId: "team-initial", teamScope: scope });
    expect(initial.memoryOrigin).toEqual({ kind: "team", ...scope });
    const first = runtime.getIdentity();
    for (const creationId of [undefined, "team-next"]) {
      if (creationId) expect((await runtime.createSession(creationId, scope)).memoryOrigin).toEqual({ kind: "team", ...scope });
      const manager = SessionManager.open(runtime.getIdentity().sessionPath!);
      const markers = manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === "pi67.memory-provenance.v1");
      expect(markers).toHaveLength(1);
      expect(markers[0]).toMatchObject({ data: { ...identity, version: 1, kind: "team", originSessionId: manager.getSessionId() } });
      expect(readTeamSessionIdentity(manager)).toEqual({ ...identity, endpoint: "https://server.fixture/" });
      expect(() => markTeamSessionBirth(manager, { ...identity, teamId: "other" })).toThrow("birth");
      expect(() => assertPrivateMemoryProvenance(manager)).toThrow();
      expect(sharedHistoryNeedsAuthorization(manager)).toBe(true);
    }
    expect(runtime.getIdentity().sessionId).not.toBe(first.sessionId);
    expect(authorizeTeamSession).toHaveBeenCalledTimes(2);
    expect(authorizeTeamSession).toHaveBeenCalledWith(scope);
    await expect(runtime.createSession("team-next", { ...scope, teamId: "other" })).rejects.toThrow();
  } finally { await runtime.dispose(); await rm(root, { recursive: true, force: true }); }
}, 15_000);

it("rejects team creation without an authorization port before materializing a Session", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-team-denied-"));
  const runtime = new PiSdkRuntime();
  try {
    await expect(runtime.initialize({ cwd: root, agentDir: join(root, "agent"), trust: "unknown", approvalMode: "guided",
      creationId: "team-denied", teamScope: scope })).rejects.toThrow("authorization is unavailable");
  } finally { await runtime.dispose(); await rm(root, { recursive: true, force: true }); }
});
