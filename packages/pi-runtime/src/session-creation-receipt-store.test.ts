import { link, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSessionCreationMarker,
  SESSION_CREATION_MARKER_TYPE,
  SessionCreationReceiptStore
} from "./session-creation-receipt-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SessionCreationReceiptStore", () => {
  it("resolves an exact persisted JSONL marker without adding LLM messages", async () => {
    const fixture = await createFixture();
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-1");

    expect(manager.getEntries()).toEqual([
      expect.objectContaining({
        type: "custom",
        customType: SESSION_CREATION_MARKER_TYPE,
        data: { schemaVersion: 1, creationId: "session-creation-1" }
      })
    ]);
    expect(manager.buildSessionContext().messages).toEqual([]);
    manager.appendThinkingLevelChange("low");

    const identity = await fixture.store.record("session-creation-1", manager);
    await expect(fixture.store.resolve("session-creation-1")).resolves.toEqual({
      status: "materialized",
      creationId: "session-creation-1",
      ...identity
    });

    const listed = await SessionManager.list(fixture.cwd, fixture.sessionDir);
    expect(listed).toEqual([
      expect.objectContaining({ id: manager.getSessionId(), messageCount: 0 })
    ]);
  });

  it("rebuilds a deleted journal entry from bounded JSONL scanning", async () => {
    const fixture = await createFixture();
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-rebuild");
    await fixture.store.record("session-creation-rebuild", manager);

    const journalDirectory = join(fixture.storageRoot, "session-creation-journal-v1");
    const entries = await readdir(journalDirectory);
    expect(entries).toHaveLength(1);
    await unlink(join(journalDirectory, entries[0]!));

    await expect(fixture.store.resolve("session-creation-rebuild")).resolves.toMatchObject({
      status: "materialized",
      creationId: "session-creation-rebuild",
      sessionId: manager.getSessionId(),
      sessionPath: manager.getSessionFile()
    });
    expect(await readdir(journalDirectory)).toHaveLength(1);
  });

  it("fails closed after restart when materialization started without an exact marker", async () => {
    const fixture = await createFixture();
    await expect(fixture.store.reserve("session-creation-interrupted")).resolves.toMatchObject({
      state: "reserved",
      creationId: "session-creation-interrupted"
    });
    await expect(fixture.store.beginMaterialization(
      "session-creation-interrupted"
    )).resolves.toEqual({
      status: "started",
      creationId: "session-creation-interrupted"
    });

    const restarted = createStore(fixture);
    await expect(restarted.beginMaterialization("session-creation-interrupted")).resolves.toEqual({
      status: "ambiguous",
      creationId: "session-creation-interrupted"
    });
    await expect(restarted.journalEntry("session-creation-interrupted")).resolves.toMatchObject({
      state: "ambiguous"
    });
  });

  it("recovers a marker written before the materialized journal transition", async () => {
    const fixture = await createFixture();
    await fixture.store.reserve("session-creation-crash-after-marker");
    await fixture.store.beginMaterialization("session-creation-crash-after-marker");
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-crash-after-marker");

    const restarted = createStore(fixture);
    await expect(restarted.resolve("session-creation-crash-after-marker")).resolves.toMatchObject({
      status: "materialized",
      creationId: "session-creation-crash-after-marker",
      sessionId: manager.getSessionId(),
      sessionPath: manager.getSessionFile()
    });
    await expect(restarted.beginMaterialization(
      "session-creation-crash-after-marker"
    )).resolves.toMatchObject({
      status: "materialized",
      sessionId: manager.getSessionId()
    });
    await expect(restarted.journalEntry("session-creation-crash-after-marker")).resolves.toMatchObject({
      state: "materialized",
      sessionId: manager.getSessionId(),
      sessionFileIdentity: expect.any(String)
    });
  });

  it("advances publication monotonically without persisting user content", async () => {
    let now = 1_000;
    const fixture = await createFixture({ now: () => now });
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await fixture.store.reserve("session-creation-publication");
    await fixture.store.beginMaterialization("session-creation-publication");
    await appendSessionCreationMarker(manager, "session-creation-publication");
    const identity = await fixture.store.record("session-creation-publication", manager);
    now += 1;
    await fixture.store.markPublished("session-creation-publication", identity);
    now += 1;
    await fixture.store.markPublished("session-creation-publication", identity);

    const entry = await fixture.store.journalEntry("session-creation-publication");
    expect(entry).toEqual({
      version: 1,
      creationId: "session-creation-publication",
      workspaceKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
      state: "published",
      sessionId: manager.getSessionId(),
      sessionPath: manager.getSessionFile(),
      sessionFileIdentity: expect.any(String),
      createdAt: 1_000,
      updatedAt: 1_002
    });
    expect(JSON.stringify(entry)).not.toContain("prompt");
  });

  it("migrates an exact legacy receipt into the durable journal", async () => {
    const fixture = await createFixture();
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-legacy");
    await fixture.store.record("session-creation-legacy", manager);
    const journalDirectory = join(fixture.storageRoot, "session-creation-journal-v1");
    const [name] = await readdir(journalDirectory);
    const journalPath = join(journalDirectory, name!);
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as Record<string, unknown>;
    await unlink(journalPath);
    const legacyDirectory = join(fixture.storageRoot, "session-creation-receipts-v1");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(join(legacyDirectory, name!), `${JSON.stringify({
      version: 1,
      creationId: journal.creationId,
      workspaceKey: journal.workspaceKey,
      sessionId: journal.sessionId,
      sessionPath: journal.sessionPath
    })}\n`, "utf8");

    const restarted = createStore(fixture);
    await expect(restarted.resolve("session-creation-legacy")).resolves.toMatchObject({
      status: "materialized",
      sessionId: manager.getSessionId()
    });
    expect(await readdir(journalDirectory)).toEqual([name]);
  });

  it("fails closed when one creation id appears in multiple Pi JSONL Sessions", async () => {
    const fixture = await createFixture();
    const first = SessionManager.create(fixture.cwd, fixture.sessionDir);
    const second = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(first, "session-creation-duplicate");
    await appendSessionCreationMarker(second, "session-creation-duplicate");

    await expect(fixture.store.resolve("session-creation-duplicate")).resolves.toEqual({
      status: "ambiguous",
      creationId: "session-creation-duplicate"
    });
  });

  it("treats hard-linked JSONL paths as one physical fallback match", async () => {
    const fixture = await createFixture();
    const defaultDirectory = defaultSessionDirectory(fixture.cwd, fixture.agentDir);
    const aliasDirectory = join(fixture.storageRoot, "session-aliases");
    await Promise.all([
      mkdir(defaultDirectory, { recursive: true }),
      mkdir(aliasDirectory, { recursive: true })
    ]);
    const manager = SessionManager.create(fixture.cwd, defaultDirectory);
    await appendSessionCreationMarker(manager, "session-creation-hardlink");
    const sessionPath = manager.getSessionFile();
    if (!sessionPath) throw new Error("Expected a persisted Session path.");
    await link(sessionPath, join(aliasDirectory, "alias.jsonl"));
    const store = new SessionCreationReceiptStore({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      storageRoot: fixture.storageRoot,
      getConfiguredSessionDir: () => aliasDirectory
    });

    await expect(store.resolve("session-creation-hardlink")).resolves.toMatchObject({
      status: "materialized",
      creationId: "session-creation-hardlink",
      sessionId: manager.getSessionId()
    });
  });

  it("returns scan-limit when the total fallback budget is exhausted", async () => {
    const fixture = await createFixture();
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-other");

    await expect(fixture.store.resolve("session-creation-budget", {
      scanBudget: { maxFiles: 0 }
    })).resolves.toEqual({
      status: "unavailable",
      creationId: "session-creation-budget",
      reason: "scan-limit"
    });
  });

  it("propagates caller cancellation instead of reporting a storage failure", async () => {
    const fixture = await createFixture();
    const manager = SessionManager.create(fixture.cwd, fixture.sessionDir);
    await appendSessionCreationMarker(manager, "session-creation-cancelled");
    const controller = new AbortController();
    const resolution = fixture.store.resolve("session-creation-cancelled", {
      signal: controller.signal
    });
    queueMicrotask(() => controller.abort());

    await expect(resolution).rejects.toMatchObject({ name: "AbortError" });
  });
});

async function createFixture(options: { now?: () => number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-creation-"));
  roots.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  const storageRoot = join(root, "storage");
  return {
    cwd,
    agentDir,
    sessionDir,
    storageRoot,
    store: new SessionCreationReceiptStore({
      cwd,
      agentDir,
      storageRoot,
      getConfiguredSessionDir: () => sessionDir,
      ...options
    })
  };
}

function createStore(fixture: Awaited<ReturnType<typeof createFixture>>): SessionCreationReceiptStore {
  return new SessionCreationReceiptStore({
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    storageRoot: fixture.storageRoot,
    getConfiguredSessionDir: () => fixture.sessionDir
  });
}

function defaultSessionDirectory(cwd: string, agentDir: string): string {
  const safePath = `--${resolve(cwd).replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
  return join(resolve(agentDir), "sessions", safePath);
}
