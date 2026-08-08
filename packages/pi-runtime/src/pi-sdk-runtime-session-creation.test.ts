import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import type { RuntimeSessionCatalogOwner } from "./runtime-session-catalog.js";
import {
  appendSessionCreationMarker,
  SESSION_CREATION_MARKER_TYPE
} from "./session-creation-receipt-store.js";
import { createPiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PiSdkRuntime Session creation identity", () => {
  it("persists the same creation marker when session.create initializes a fresh Task", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-initial-session-creation-"));
    roots.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const storageRoot = join(root, "storage");
    await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(storageRoot)]);

    const sessionCatalogOwner = catalogOwner(() => true);
    const services = createPiWorkspaceRuntimeServices({
      cwd,
      agentDir,
      storageRoot,
      settingsManager: SettingsManager.inMemory(),
      sessionCatalogOwner
    });
    const runtime = new PiSdkRuntime({ workspaceServices: services });
    const catalogEvents: string[] = [];
    runtime.subscribe((event) => {
      if (event.type === "session.catalog.changed") catalogEvents.push(event.payload.reason);
    });
    try {
      const snapshot = await runtime.initialize({
        cwd,
        agentDir,
        trust: "trusted",
        approvalMode: "guided",
        creationId: "session-creation-initial-task"
      });
      expect(await jsonlFiles(root)).toHaveLength(1);
      expect(snapshot.sessionId).toBe(runtime.getIdentity().sessionId);
      await vi.waitFor(() => expect(catalogEvents).toContain("session-created"));

      const identity = runtime.getIdentity();
      const manager = SessionManager.open(identity.sessionPath!);
      expect(manager.getEntries()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "custom",
          customType: SESSION_CREATION_MARKER_TYPE,
          data: {
            schemaVersion: 1,
            creationId: "session-creation-initial-task"
          }
        })
      ]));
      await expect(services.sessionCreationReceipts.resolve(
        "session-creation-initial-task"
      )).resolves.toMatchObject({
        status: "materialized",
        creationId: "session-creation-initial-task",
        sessionId: identity.sessionId,
        sessionPath: identity.sessionPath
      });
    } finally {
      await runtime.dispose();
      await services.dispose();
      await sessionCatalogOwner.dispose();
    }
  }, 15_000);

  it("keeps a created Session authoritative when a later Catalog projection fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-session-creation-"));
    roots.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const storageRoot = join(root, "storage");
    await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(storageRoot)]);

    let failCatalogUpsert = false;
    const sessionCatalogOwner = catalogOwner(() => failCatalogUpsert);
    const services = createPiWorkspaceRuntimeServices({
      cwd,
      agentDir,
      storageRoot,
      settingsManager: SettingsManager.inMemory(),
      sessionCatalogOwner
    });
    const runtime = new PiSdkRuntime({ workspaceServices: services });
    try {
      await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
      failCatalogUpsert = true;

      const snapshot = await runtime.createSession("session-creation-catalog-failure");
      expect(snapshot.sessionId).toBe(runtime.getIdentity().sessionId);

      const identity = runtime.getIdentity();
      expect(identity.sessionPath).toBeTruthy();
      const manager = SessionManager.open(identity.sessionPath!);
      expect(manager.getEntries()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "custom",
          customType: SESSION_CREATION_MARKER_TYPE,
          data: {
            schemaVersion: 1,
            creationId: "session-creation-catalog-failure"
          }
        })
      ]));
      expect(manager.buildSessionContext().messages).toEqual([]);
      await expect(services.sessionCreationReceipts.resolve(
        "session-creation-catalog-failure"
      )).resolves.toMatchObject({
        status: "materialized",
        creationId: "session-creation-catalog-failure",
        sessionId: identity.sessionId,
        sessionPath: identity.sessionPath
      });
    } finally {
      await runtime.dispose();
      await services.dispose();
      await sessionCatalogOwner.dispose();
    }
  }, 15_000);

  it("does not create another JSONL when a published creation id is replayed after restart", async () => {
    const fixture = await createRuntimeFixture("pi67-sdk-session-creation-replay-");
    const runtimeA = new PiSdkRuntime({ workspaceServices: fixture.services });
    const runtimeB = new PiSdkRuntime({ workspaceServices: fixture.services });
    try {
      await runtimeA.initialize(runtimeInitializeOptions(fixture));
      const created = await runtimeA.createSession("session-creation-replayed");
      expect(await creationMarkerFiles(
        fixture.root,
        "session-creation-replayed"
      )).toHaveLength(1);
      await runtimeA.dispose();
      await rm(join(fixture.storageRoot, "session-creation-journal-v1"), {
        recursive: true,
        force: true
      });

      await runtimeB.initialize(runtimeInitializeOptions(fixture));
      const runtimeBSessionId = runtimeB.getIdentity().sessionId;
      const filesBeforeReplay = await jsonlFiles(fixture.root);
      await expect(runtimeB.createSession("session-creation-replayed")).rejects.toMatchObject({
        code: "REQUEST_OUTCOME_UNKNOWN"
      });

      expect(runtimeB.getIdentity().sessionId).toBe(runtimeBSessionId);
      expect(await jsonlFiles(fixture.root)).toEqual(filesBeforeReplay);
      expect(await creationMarkerFiles(
        fixture.root,
        "session-creation-replayed"
      )).toHaveLength(1);
      await expect(fixture.services.sessionCreationReceipts.resolve(
        "session-creation-replayed"
      )).resolves.toMatchObject({
        status: "materialized",
        sessionId: created.sessionId
      });
    } finally {
      await Promise.all([runtimeA.dispose(), runtimeB.dispose()]);
      await fixture.services.dispose();
      await fixture.sessionCatalogOwner.dispose();
    }
  }, 15_000);

  it("does not initialize a second Task Session when its durable journal must be rebuilt", async () => {
    const fixture = await createRuntimeFixture("pi67-sdk-initial-session-creation-replay-");
    const runtimeA = new PiSdkRuntime({ workspaceServices: fixture.services });
    const runtimeB = new PiSdkRuntime({ workspaceServices: fixture.services });
    const creationId = "session-creation-initial-replayed";
    try {
      await runtimeA.initialize({
        ...runtimeInitializeOptions(fixture),
        creationId
      });
      const filesBeforeReplay = await jsonlFiles(fixture.root);
      expect(await creationMarkerFiles(fixture.root, creationId)).toHaveLength(1);
      await runtimeA.dispose();
      await rm(join(fixture.storageRoot, "session-creation-journal-v1"), {
        recursive: true,
        force: true
      });

      await expect(runtimeB.initialize({
        ...runtimeInitializeOptions(fixture),
        creationId
      })).rejects.toMatchObject({ code: "REQUEST_OUTCOME_UNKNOWN" });

      expect(await jsonlFiles(fixture.root)).toEqual(filesBeforeReplay);
      expect(await creationMarkerFiles(fixture.root, creationId)).toHaveLength(1);
      await expect(fixture.services.sessionCreationReceipts.resolve(creationId)).resolves.toMatchObject({
        status: "materialized"
      });
    } finally {
      await Promise.all([runtimeA.dispose(), runtimeB.dispose()]);
      await fixture.services.dispose();
      await fixture.sessionCatalogOwner.dispose();
    }
  }, 15_000);

  it("does not call Pi newSession when materialization has no exact marker", async () => {
    const fixture = await createRuntimeFixture("pi67-sdk-session-creation-ambiguous-");
    const runtime = new PiSdkRuntime({ workspaceServices: fixture.services });
    try {
      await fixture.services.sessionCreationReceipts.reserve("session-creation-no-marker");
      await fixture.services.sessionCreationReceipts.beginMaterialization("session-creation-no-marker");
      await runtime.initialize(runtimeInitializeOptions(fixture));
      const sessionId = runtime.getIdentity().sessionId;
      const filesBeforeReplay = await jsonlFiles(fixture.root);

      await expect(runtime.createSession("session-creation-no-marker")).rejects.toMatchObject({
        code: "REQUEST_OUTCOME_UNKNOWN"
      });

      expect(runtime.getIdentity().sessionId).toBe(sessionId);
      expect(await jsonlFiles(fixture.root)).toEqual(filesBeforeReplay);
      expect(await creationMarkerFiles(fixture.root, "session-creation-no-marker")).toEqual([]);
      await expect(fixture.services.sessionCreationReceipts.journalEntry(
        "session-creation-no-marker"
      )).resolves.toMatchObject({ state: "ambiguous" });
    } finally {
      await runtime.dispose();
      await fixture.services.dispose();
      await fixture.sessionCatalogOwner.dispose();
    }
  }, 15_000);

  it("recovers an exact marker without calling Pi newSession", async () => {
    const fixture = await createRuntimeFixture("pi67-sdk-session-creation-recovered-");
    const runtime = new PiSdkRuntime({ workspaceServices: fixture.services });
    const creationId = "session-creation-recovered-marker";
    try {
      await fixture.services.sessionCreationReceipts.reserve(creationId);
      await fixture.services.sessionCreationReceipts.beginMaterialization(creationId);
      const recoveredManager = SessionManager.create(fixture.cwd, fixture.sessionDir);
      await appendSessionCreationMarker(recoveredManager, creationId);

      await runtime.initialize(runtimeInitializeOptions(fixture));
      const sessionId = runtime.getIdentity().sessionId;
      const filesBeforeReplay = await jsonlFiles(fixture.root);
      await expect(runtime.createSession(creationId)).rejects.toMatchObject({
        code: "REQUEST_OUTCOME_UNKNOWN"
      });

      expect(runtime.getIdentity().sessionId).toBe(sessionId);
      expect(await jsonlFiles(fixture.root)).toEqual(filesBeforeReplay);
      expect(await creationMarkerFiles(fixture.root, creationId)).toHaveLength(1);
      await expect(fixture.services.sessionCreationReceipts.resolve(creationId)).resolves.toMatchObject({
        status: "materialized",
        sessionId: recoveredManager.getSessionId()
      });
    } finally {
      await runtime.dispose();
      await fixture.services.dispose();
      await fixture.sessionCatalogOwner.dispose();
    }
  }, 15_000);
});

async function createRuntimeFixture(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const storageRoot = join(root, "storage");
  const sessionDir = join(root, "sessions");
  await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(storageRoot), mkdir(sessionDir)]);
  const sessionCatalogOwner = catalogOwner(() => false);
  const services = createPiWorkspaceRuntimeServices({
    cwd,
    agentDir,
    storageRoot,
    settingsManager: SettingsManager.inMemory({ sessionDir }),
    sessionCatalogOwner
  });
  return { root, cwd, agentDir, storageRoot, sessionDir, services, sessionCatalogOwner };
}

function runtimeInitializeOptions(fixture: Awaited<ReturnType<typeof createRuntimeFixture>>) {
  return {
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    trust: "trusted" as const,
    approvalMode: "guided" as const
  };
}

async function jsonlFiles(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true }))
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
}

async function creationMarkerFiles(root: string, creationId: string): Promise<string[]> {
  return (await jsonlFiles(root)).filter((path) => {
    const manager = SessionManager.open(join(root, path));
    return manager.getEntries().some((entry) => (
      entry.type === "custom"
      && entry.customType === SESSION_CREATION_MARKER_TYPE
      && entry.data !== null
      && typeof entry.data === "object"
      && "creationId" in entry.data
      && entry.data.creationId === creationId
    ));
  });
}

function catalogOwner(shouldFail: () => boolean): RuntimeSessionCatalogOwner {
  return {
    createBinding() {
      return {
        query: async () => ({
          revision: 0,
          itemCount: 0,
          source: "sqlite",
          state: "ready",
          rebuilding: false,
          incomplete: false,
          skippedCount: 0,
          items: [],
          total: 0,
          hasMore: false
        }),
        status: () => ({
          revision: 0,
          itemCount: 0,
          source: "sqlite",
          state: "ready",
          rebuilding: false,
          incomplete: false,
          skippedCount: 0
        }),
        async upsertCurrent() {
          if (shouldFail()) throw new Error("catalog unavailable after marker");
        },
        async upsertRecord() {
          if (shouldFail()) throw new Error("catalog unavailable after marker");
        },
        organize: async () => 0,
        reorderPinned: async () => 0,
        dispose: async () => undefined
      };
    },
    status: () => ({
      revision: 0,
      itemCount: 0,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      incomplete: false,
      skippedCount: 0
    }),
    dispose: async () => undefined
  };
}
