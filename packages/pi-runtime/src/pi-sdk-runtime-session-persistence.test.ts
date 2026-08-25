import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import { SessionSemanticTitleGenerator } from "./session-semantic-title.js";

const temporaryDirectories: string[] = [];
const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiSdkRuntime session persistence", () => {
  it("schedules one automatic semantic title when a historical Session becomes live", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-session-title-activation-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions");
    await Promise.all([mkdir(cwd), mkdir(sessionDirectory, { recursive: true })]);
    const historical = SessionManager.create(cwd, sessionDirectory);
    historical.appendMessage({ role: "user", content: "查询杭州今天的实时天气", timestamp: 1 });
    historical.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "已获取杭州天气。" }],
      api: "openai-responses",
      provider: "pi67-test",
      model: "fixture",
      usage: zeroUsage,
      stopReason: "stop",
      timestamp: 2
    });
    const sessionPath = requireSessionPath(historical.getSessionFile());
    const generate = vi.spyOn(SessionSemanticTitleGenerator.prototype, "generate")
      .mockResolvedValue({ kind: "generated", title: "杭州实时天气查询" });
    const runtime = new PiSdkRuntime();
    try {
      await runtime.initialize({
        cwd,
        agentDir,
        sessionPath,
        trust: "trusted",
        approvalMode: "guided"
      });

      expect(generate).toHaveBeenCalledOnce();
      expect(generate).toHaveBeenCalledWith(expect.anything(), expect.any(Number), "automatic");
      await runtime.createSession("session-creation-after-title-activation");
      expect(generate).toHaveBeenCalledOnce();
    } finally {
      await runtime.dispose();
    }
  }, 15_000);

  it("materializes fresh and explicitly created Sessions before publishing their snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-session-persistence-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);

    const runtime = new PiSdkRuntime();
    const restoredRuntime = new PiSdkRuntime();
    const externalChanges: unknown[] = [];
    runtime.subscribe((event) => {
      if (event.type === "session.externalChangeDetected") externalChanges.push(event.payload);
    });
    try {
      const initial = await runtime.initialize({
        cwd,
        agentDir,
        trust: "trusted",
        approvalMode: "guided"
      });
      expect(externalChanges).toEqual([]);
      const initialPath = requireSessionPath(initial.sessionPath);
      await expectPersistedHeader(initialPath, initial.sessionId, cwd);
      const initialCatalog = await queryReadyCatalog(runtime);
      const initialCatalogRows = initialCatalog.items.filter((session) => session.id === initial.sessionId);
      expect(initialCatalogRows).toHaveLength(1);
      expect(initialCatalogRows[0]?.path).toBe(initialPath);
      await runtime.setSessionName("Persisted empty Session");
      expect(externalChanges).toEqual([]);

      const created = await runtime.createSession("session-creation-persistence");
      const createdPath = requireSessionPath(created.sessionPath);
      expect(created.sessionId).not.toBe(initial.sessionId);
      expect(createdPath).not.toBe(initialPath);
      await expectPersistedHeader(createdPath, created.sessionId, cwd);

      await runtime.dispose();
      const discovered = await SessionManager.listAll(dirname(createdPath));
      expect(discovered).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: initial.sessionId, messageCount: 0, name: "Persisted empty Session" }),
        expect.objectContaining({ id: created.sessionId, messageCount: 0 })
      ]));

      const restoredInitial = await restoredRuntime.initialize({
        cwd,
        agentDir,
        sessionPath: initialPath,
        trust: "trusted",
        approvalMode: "guided"
      });
      expect(restoredInitial).toMatchObject({
        sessionId: initial.sessionId,
        sessionPath: initialPath,
        messages: []
      });

      const restoredCreated = await restoredRuntime.initialize({
        cwd,
        agentDir,
        sessionPath: createdPath,
        trust: "trusted",
        approvalMode: "guided"
      });
      expect(restoredCreated).toMatchObject({
        sessionId: created.sessionId,
        sessionPath: createdPath,
        messages: []
      });
    } finally {
      await runtime.dispose();
      await restoredRuntime.dispose();
    }
  }, 15_000);
});

function requireSessionPath(sessionPath: string | undefined): string {
  if (!sessionPath) throw new Error("A persisted Pi Session must expose a session path.");
  return sessionPath;
}

async function expectPersistedHeader(path: string, sessionId: string, cwd: string): Promise<void> {
  const content = await readFile(path, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);
  expect(lines.length).toBeGreaterThan(0);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    type: "session",
    version: 3,
    id: sessionId,
    cwd
  });
  expect(lines.slice(1).map((line) => JSON.parse(line) as { type: string }))
    .not.toContainEqual(expect.objectContaining({ type: "message" }));
}

async function queryReadyCatalog(runtime: PiSdkRuntime) {
  await runtime.querySessionCatalog({ scope: "workspace", refresh: true });
  await vi.waitFor(() => expect(runtime.getSessionCatalogStatus().rebuilding).toBe(false), { timeout: 5_000 });
  return runtime.querySessionCatalog({ scope: "workspace" });
}
