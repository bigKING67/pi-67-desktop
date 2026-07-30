import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SessionCatalogPage, SessionCatalogStatus } from "@pi67/domain";
import type {
  PiWorkspaceRuntimeServices,
  RuntimeSessionCatalogOwner
} from "@pi67/pi-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceContextRegistry,
  type WorkspaceServicesFactory
} from "./workspace-context-registry.js";

const STATUS: SessionCatalogStatus = {
  revision: 0,
  itemCount: 0,
  source: "sqlite",
  state: "ready",
  rebuilding: false,
  incomplete: false,
  skippedCount: 0
};

const PAGE: SessionCatalogPage = {
  ...STATUS,
  items: [],
  total: 0,
  hasMore: false
};

describe("WorkspaceContextRegistry", () => {
  it("creates one shared Workspace services owner and disposes its catalog binding first", async () => {
    const fixture = fakeServicesFactory();
    const registry = new WorkspaceContextRegistry({ createServices: fixture.createServices });

    const first = registry.register("workspace-1", {
      cwd: "/workspace",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    });
    const second = registry.register("workspace-1", {
      cwd: "/workspace/../workspace",
      agentDir: "/agent",
      trust: "unknown",
      approvalMode: "balanced"
    });
    expect(second).toBe(first);
    expect(fixture.createServices).toHaveBeenCalledOnce();
    expect(fixture.assertCompatible).toHaveBeenCalledWith(resolve("/workspace"), "/agent");
    expect(first.initialization).toEqual({
      cwd: resolve("/workspace"),
      agentDir: "/agent",
      trust: "unknown",
      approvalMode: "balanced"
    });
    expect(fixture.setProjectTrusted).toHaveBeenCalledWith(false);

    await registry.disposeAll();
    expect(fixture.disposalOrder).toEqual(["binding", "services"]);
  });

  it("owns canonical cwd identity across aliases and rejects a second Workspace identity", () => {
    const fixture = fakeServicesFactory();
    const registry = new WorkspaceContextRegistry({ createServices: fixture.createServices });
    registry.register("workspace-1", {
      cwd: "/projects/one/../one",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    });

    expect(registry.workspaceIdForCwd("/projects/one")).toBe("workspace-1");
    expect(() => registry.register("workspace-2", {
      cwd: "/projects/one",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    })).toThrow(expect.objectContaining({ code: "DUPLICATE_REQUEST" }));
    expect(() => registry.register("workspace-1", {
      cwd: "/projects/two",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    })).toThrow(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
  });

  it("uses filesystem identity when a Workspace is reached through a directory link", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-workspace-identity-"));
    const target = join(root, "target");
    const alias = join(root, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const fixture = fakeServicesFactory();
    const registry = new WorkspaceContextRegistry({ createServices: fixture.createServices });

    registry.register("workspace-1", {
      cwd: target,
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    });
    expect(registry.workspaceIdForCwd(alias)).toBe("workspace-1");
    expect(() => registry.register("workspace-2", {
      cwd: alias,
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    })).toThrow(expect.objectContaining({ code: "DUPLICATE_REQUEST" }));
  });

  it("queries a Workspace catalog without a Task Runtime and publishes Workspace events", async () => {
    const fixture = fakeServicesFactory();
    const emitWorkspaceEvent = vi.fn();
    const registry = new WorkspaceContextRegistry({
      createServices: fixture.createServices,
      emitWorkspaceEvent
    });
    registry.register("workspace-1", {
      cwd: "/workspace",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    });

    await expect(registry.queryCatalog("workspace-1", { scope: "workspace", limit: 50 }))
      .resolves.toEqual(PAGE);
    expect(registry.statusFor("workspace-1")).toEqual(STATUS);
    fixture.emit?.({ type: "session.catalog.changed", payload: { revision: 1, reason: "reconciled" } });
    expect(emitWorkspaceEvent).toHaveBeenCalledWith("workspace-1", {
      type: "session.catalog.changed",
      payload: { revision: 1, reason: "reconciled" }
    });
    await expect(registry.queryCatalog("workspace-1", { scope: "all" }))
      .rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("unregisters only after both the binding and services are disposed", async () => {
    const fixture = fakeServicesFactory();
    const registry = new WorkspaceContextRegistry({ createServices: fixture.createServices });
    registry.register("workspace-1", {
      cwd: "/workspace",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    });

    await registry.unregister("workspace-1");
    expect(fixture.disposalOrder).toEqual(["binding", "services"]);
    expect(registry.get("workspace-1")).toBeUndefined();
    expect(registry.workspaceIdForCwd("/workspace")).toBeUndefined();
  });

  it("retains Workspace identity when unregister disposal fails", async () => {
    const fixture = fakeServicesFactory({ servicesDisposeError: new Error("flush failed") });
    const registry = new WorkspaceContextRegistry({ createServices: fixture.createServices });
    registry.register("workspace-1", {
      cwd: "/workspace",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    });

    await expect(registry.unregister("workspace-1")).rejects.toThrow("flush failed");
    expect(registry.get("workspace-1")).toBeDefined();
    expect(registry.workspaceIdForCwd("/workspace")).toBe("workspace-1");
  });

  it("fails closed for an unknown Workspace", () => {
    const registry = new WorkspaceContextRegistry();
    expect(() => registry.require("missing")).toThrow(expect.objectContaining({
      code: "RUNTIME_NOT_READY"
    }));
  });

  it("continues disposing other Workspace services after one owner fails", async () => {
    const first = fakeServicesFactory();
    const second = fakeServicesFactory({ servicesDisposeError: new Error("workspace dispose failed") });
    const factories: WorkspaceServicesFactory[] = [
      (options) => first.createServices(options),
      (options) => second.createServices(options)
    ];
    const createServices = vi.fn((options: Parameters<WorkspaceServicesFactory>[0]) => (
      factories.shift()!(options)
    ));
    const registry = new WorkspaceContextRegistry({ createServices });
    registry.register("workspace-1", {
      cwd: "/workspace-1",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    });
    registry.register("workspace-2", {
      cwd: "/workspace-2",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided"
    });

    await expect(registry.disposeAll()).rejects.toThrow("workspace dispose failed");
    expect(first.disposalOrder).toEqual(["binding", "services"]);
    expect(second.disposalOrder).toEqual(["binding", "services"]);
    expect(registry.values().map((record) => record.workspaceId)).toEqual(["workspace-2"]);
    expect(registry.workspaceIdForCwd("/workspace-2")).toBe("workspace-2");
  });

  it("injects one Agent Host Session Catalog owner into every Workspace and disposes it last", async () => {
    const first = fakeServicesFactory();
    const second = fakeServicesFactory();
    const factories: WorkspaceServicesFactory[] = [first.createServices, second.createServices];
    const createServices = vi.fn((options: Parameters<WorkspaceServicesFactory>[0]) => (
      factories.shift()!(options)
    ));
    const ownerDispose = vi.fn(async () => undefined);
    const sharedOwner = {
      createBinding: vi.fn(),
      status: vi.fn(),
      dispose: ownerDispose
    } as unknown as RuntimeSessionCatalogOwner;
    const createSessionCatalogOwner = vi.fn(() => sharedOwner);
    const registry = new WorkspaceContextRegistry({
      createServices,
      createSessionCatalogOwner
    });

    registry.register("workspace-1", {
      cwd: "/workspace-1",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided",
      sessionCatalogDirectory: "/storage/projections/session-catalog",
      storageRoot: "/storage"
    });
    registry.register("workspace-2", {
      cwd: "/workspace-2",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided",
      sessionCatalogDirectory: "/storage/projections/session-catalog",
      storageRoot: "/storage"
    });

    expect(createSessionCatalogOwner).toHaveBeenCalledOnce();
    expect(createServices.mock.calls[0]?.[0].sessionCatalogOwner).toBe(sharedOwner);
    expect(createServices.mock.calls[1]?.[0].sessionCatalogOwner).toBe(sharedOwner);

    await registry.unregister("workspace-1");
    expect(ownerDispose).not.toHaveBeenCalled();
    await registry.disposeAll();
    expect(ownerDispose).toHaveBeenCalledOnce();
  });

  it("rejects a Workspace that attempts to replace the Agent Host catalog storage", () => {
    const fixture = fakeServicesFactory();
    const registry = new WorkspaceContextRegistry({ createServices: fixture.createServices });
    registry.register("workspace-1", {
      cwd: "/workspace-1",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided",
      sessionCatalogDirectory: "/storage-a/projections/session-catalog",
      storageRoot: "/storage-a"
    });

    expect(() => registry.register("workspace-2", {
      cwd: "/workspace-2",
      agentDir: "/agent",
      trust: "trusted",
      approvalMode: "guided",
      sessionCatalogDirectory: "/storage-b/projections/session-catalog",
      storageRoot: "/storage-b"
    })).toThrow(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
    expect(fixture.createServices).toHaveBeenCalledOnce();
  });

  it("keeps two real Workspace catalog bindings on SQLite after either Workspace reconciles", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi67-shared-workspace-catalog-")));
    const storageRoot = join(root, "storage");
    const sessionCatalogDirectory = join(storageRoot, "projections", "session-catalog");
    const agentDir = join(root, "agent");
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    await Promise.all([
      mkdir(sessionCatalogDirectory, { recursive: true }),
      mkdir(join(agentDir, "sessions"), { recursive: true }),
      mkdir(workspaceA),
      mkdir(workspaceB)
    ]);
    const registry = new WorkspaceContextRegistry();

    try {
      for (const [workspaceId, cwd] of [["workspace-a", workspaceA], ["workspace-b", workspaceB]] as const) {
        registry.register(workspaceId, {
          cwd,
          agentDir,
          trust: "trusted",
          approvalMode: "guided",
          sessionCatalogDirectory,
          storageRoot
        });
      }

      await registry.queryCatalog("workspace-a", { scope: "workspace", limit: 50, refresh: true });
      await waitForReadyCatalog(registry, "workspace-a");
      await registry.queryCatalog("workspace-b", { scope: "workspace", limit: 50, refresh: true });
      await waitForReadyCatalog(registry, "workspace-b");

      const firstAfterPeerWrite = await registry.queryCatalog("workspace-a", {
        scope: "workspace",
        limit: 50
      });
      expect(firstAfterPeerWrite).toMatchObject({
        source: "sqlite",
        state: "ready",
        rebuilding: false
      });
      expect(firstAfterPeerWrite.degradedReason).toBeUndefined();
      expect(registry.statusFor("workspace-b")).toMatchObject({
        source: "sqlite",
        state: "ready",
        rebuilding: false
      });
    } finally {
      await registry.disposeAll();
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});

async function waitForReadyCatalog(
  registry: WorkspaceContextRegistry,
  workspaceId: string
): Promise<void> {
  await vi.waitFor(() => {
    const status = registry.statusFor(workspaceId);
    if (status.source !== "sqlite" || status.state !== "ready" || status.rebuilding) {
      throw new Error(`Catalog did not become ready: ${JSON.stringify(status)}`);
    }
  }, { timeout: 5_000, interval: 25 });
}

function fakeServicesFactory(options: { servicesDisposeError?: Error } = {}) {
  const disposalOrder: string[] = [];
  const assertCompatible = vi.fn();
  const setProjectTrusted = vi.fn();
  let emit: Parameters<
    PiWorkspaceRuntimeServices["sessionCatalog"]["createBinding"]
  >[0]["emit"] | undefined;
  const createServices = vi.fn((serviceOptions: Parameters<WorkspaceServicesFactory>[0]) => ({
    cwd: serviceOptions.cwd,
    agentDir: serviceOptions.agentDir,
    assertCompatible,
    setProjectTrusted,
    sessionCatalog: {
      createBinding: vi.fn((target: Parameters<
        PiWorkspaceRuntimeServices["sessionCatalog"]["createBinding"]
      >[0]) => {
        emit = (event) => target.emit(event);
        return {
          query: vi.fn(async () => PAGE),
          status: vi.fn(() => STATUS),
          upsertCurrent: vi.fn(async () => undefined),
          dispose: vi.fn(async () => { disposalOrder.push("binding"); })
        };
      }),
      status: vi.fn(() => STATUS),
      dispose: vi.fn(async () => undefined)
    },
    dispose: vi.fn(async () => {
      disposalOrder.push("services");
      if (options.servicesDisposeError) throw options.servicesDisposeError;
    })
  } as unknown as PiWorkspaceRuntimeServices));
  return {
    createServices,
    assertCompatible,
    setProjectTrusted,
    disposalOrder,
    get emit() { return emit; }
  };
}
