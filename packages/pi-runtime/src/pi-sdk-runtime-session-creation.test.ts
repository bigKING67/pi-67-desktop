import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import type { RuntimeSessionCatalogOwner } from "./runtime-session-catalog.js";
import { SESSION_CREATION_MARKER_TYPE } from "./session-creation-receipt-store.js";
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
    try {
      await expect(runtime.initialize({
        cwd,
        agentDir,
        trust: "trusted",
        approvalMode: "guided",
        creationId: "session-creation-initial-task"
      })).rejects.toMatchObject({
        code: "REQUEST_OUTCOME_UNKNOWN",
        details: { creationId: "session-creation-initial-task" }
      });

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

  it("persists the exact marker before a later Catalog failure", async () => {
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

      await expect(runtime.createSession("session-creation-catalog-failure")).rejects.toMatchObject({
        code: "REQUEST_OUTCOME_UNKNOWN",
        details: { creationId: "session-creation-catalog-failure" }
      });

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
});

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
