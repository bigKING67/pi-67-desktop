import type { AgentRuntime, PiWorkspaceRuntimeServices } from "@pi67/pi-runtime";
import type { ExtensionPackageListResult, ExtensionPackageMutationResult } from "@pi67/domain";
import type { AgentCommand, WorkspaceProtocolContext } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  ExtensionPackageCommandRouter,
  type ExtensionPackageCommandType,
  type ExtensionPackageTaskView
} from "./extension-package-command-router.js";

const WORKSPACE_A: WorkspaceProtocolContext = { scope: "workspace", workspaceId: "workspace-a" };
const EMPTY_LIST: ExtensionPackageListResult = { items: [], total: 0 };
const MUTATED_LIST: ExtensionPackageMutationResult = { items: [], total: 0, changed: true };

describe("ExtensionPackageCommandRouter", () => {
  it("routes Workspace queries without exposing a Task Runtime", async () => {
    const list = vi.fn(() => EMPTY_LIST);
    const checkForUpdates = vi.fn(async () => ({ items: [], total: 0 }));
    const router = createRouter({ list, checkForUpdates });

    await expect(router.dispatch(WORKSPACE_A, command("extension.package.list", {})))
      .resolves.toEqual(EMPTY_LIST);
    await expect(router.dispatch(WORKSPACE_A, command("extension.package.checkUpdates", {})))
      .resolves.toEqual({ items: [], total: 0 });

    expect(list).toHaveBeenCalledOnce();
    expect(checkForUpdates).toHaveBeenCalledOnce();
  });

  it("rejects a global mutation unless every Task lane is idle", async () => {
    const install = vi.fn(async () => MUTATED_LIST);
    const router = createRouter({ install }, [task("workspace-a", true), task("workspace-b", false)]);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.install", { source: "npm:example", scope: "global" }),
      "install-global"
    )).rejects.toMatchObject({ code: "BUSY", details: { scope: "global" } });
    expect(install).not.toHaveBeenCalled();
  });

  it("limits a project mutation to its Workspace and reloads only its initialized Tasks", async () => {
    const update = vi.fn(async () => MUTATED_LIST);
    const runtimeA = runtime();
    const runtimeB = runtime();
    const tasks = [
      task("workspace-a", true, runtimeA.runtime),
      task("workspace-b", false, runtimeB.runtime)
    ];
    const router = createRouter({ update }, tasks);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.update", { source: "npm:example", scope: "project" }),
      "update-project"
    )).resolves.toMatchObject({ ...MUTATED_LIST, receiptState: "active" });

    expect(runtimeA.reloadResources).toHaveBeenCalledOnce();
    expect(runtimeB.reloadResources).not.toHaveBeenCalled();
  });

  it("replays one mutation result and rejects idempotency fingerprint conflicts", async () => {
    const install = vi.fn(async () => MUTATED_LIST);
    const uninstall = vi.fn(async () => MUTATED_LIST);
    const router = createRouter({ install, uninstall });
    const installCommand = command("extension.package.install", {
      source: "npm:example",
      scope: "project"
    });

    const first = router.dispatch(WORKSPACE_A, installCommand, "same-key");
    const replay = router.dispatch(WORKSPACE_A, installCommand, "same-key");
    await expect(Promise.all([first, replay])).resolves.toEqual([
      { ...MUTATED_LIST, receiptState: "active" },
      { ...MUTATED_LIST, receiptState: "active" }
    ]);
    expect(install).toHaveBeenCalledOnce();

    expect(() => router.dispatch(
      WORKSPACE_A,
      command("extension.package.uninstall", { source: "npm:example", scope: "project" }),
      "same-key"
    )).toThrow(expect.objectContaining({ code: "DUPLICATE_REQUEST" }));
    expect(uninstall).not.toHaveBeenCalled();
  });

  it("fences affected Task commands while a package mutation and reload are pending", async () => {
    let finishInstall!: () => void;
    const install = vi.fn(() => new Promise<typeof MUTATED_LIST>((resolve) => {
      finishInstall = () => resolve(MUTATED_LIST);
    }));
    const router = createRouter({ install }, [task("workspace-a", true), task("workspace-b", true)]);

    const pending = router.dispatch(
      WORKSPACE_A,
      command("extension.package.install", { source: "npm:example", scope: "project" }),
      "pending-project"
    );
    expect(() => router.assertTaskCommandAllowed("workspace-a"))
      .toThrow(expect.objectContaining({ code: "BUSY" }));
    expect(() => router.assertTaskCommandAllowed("workspace-b")).not.toThrow();

    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
    finishInstall();
    await pending;
    expect(() => router.assertTaskCommandAllowed("workspace-a")).not.toThrow();
  });

  it("reports resource reload failures after persisting the mutation and still reloads later Tasks", async () => {
    const install = vi.fn(async () => MUTATED_LIST);
    const failedRuntime = runtime(new Error("reload failed"));
    const laterRuntime = runtime();
    const router = createRouter({ install }, [
      task("workspace-a", true, failedRuntime.runtime),
      task("workspace-b", true, laterRuntime.runtime)
    ]);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.install", { source: "npm:example", scope: "global" }),
      "reload-failure"
    )).rejects.toThrow("reload failed");

    expect(install).toHaveBeenCalledOnce();
    expect(failedRuntime.reloadResources).toHaveBeenCalledOnce();
    expect(laterRuntime.reloadResources).toHaveBeenCalledOnce();
  });

  it("does not replay a worker mutation after a durable terminal receipt", async () => {
    const install = vi.fn(async () => MUTATED_LIST);
    const terminalList: ExtensionPackageListResult = {
      items: [{
        source: "npm:example",
        scope: "global",
        enabled: true,
        filtered: false,
        installed: true,
        trustState: "user-installed-observed"
      }],
      total: 1
    };
    const services = workspaceServices({
      reserve: vi.fn(async () => ({
        status: "replay" as const,
        record: {
          recordKey: "a".repeat(64),
          sourceDigest: "b".repeat(64),
          scope: "global" as const,
          sourceKind: "npm" as const,
          state: "active" as const,
          lastOperation: "install" as const,
          mutationKeyDigest: "c".repeat(64),
          fingerprintDigest: "d".repeat(64),
          startedAt: 1,
          completedAt: 2,
          changed: true,
          observation: observedPackage()
        }
      }))
    });
    const router = createRouter({ install, list: () => terminalList }, [], services);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.install", { source: "npm:example", scope: "global" }),
      "already-complete"
    )).resolves.toEqual({ ...terminalList, changed: true, receiptState: "active" });
    expect(install).not.toHaveBeenCalled();
  });

  it("returns ambiguous without replaying when a durable active receipt has drifted", async () => {
    const install = vi.fn(async () => MUTATED_LIST);
    const driftedList: ExtensionPackageListResult = {
      items: [{
        source: "npm:example",
        scope: "global",
        enabled: true,
        filtered: false,
        installed: true,
        trustState: "drifted",
        trustReason: "content-hash-changed"
      }],
      total: 1
    };
    const services = workspaceServices({
      reserve: vi.fn(async () => ({
        status: "replay" as const,
        record: {
          recordKey: "a".repeat(64),
          sourceDigest: "b".repeat(64),
          scope: "global" as const,
          sourceKind: "npm" as const,
          state: "active" as const,
          lastOperation: "install" as const,
          mutationKeyDigest: "c".repeat(64),
          fingerprintDigest: "d".repeat(64),
          startedAt: 1,
          completedAt: 2,
          changed: true,
          observation: observedPackage()
        }
      }))
    });
    const router = createRouter({ install, list: () => driftedList }, [], services);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.install", { source: "npm:example", scope: "global" }),
      "drifted-replay"
    )).resolves.toEqual({ ...driftedList, changed: true, receiptState: "ambiguous" });
    expect(install).not.toHaveBeenCalled();
  });

  it("persists an ambiguous receipt when the completed mutation cannot be observed safely", async () => {
    const install = vi.fn(async () => MUTATED_LIST);
    const markAmbiguous = vi.fn(async () => undefined);
    const commitActive = vi.fn(async () => undefined);
    const services = workspaceServices(
      { markAmbiguous, commitActive },
      { observationFor: vi.fn(() => ({ status: "unavailable", reason: "receipt-invalid" })) }
    );
    const router = createRouter({ install }, [], services);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.install", { source: "npm:example", scope: "project" }),
      "observation-failed"
    )).resolves.toMatchObject({ changed: true, receiptState: "ambiguous" });
    expect(commitActive).not.toHaveBeenCalled();
    expect(markAmbiguous).toHaveBeenCalledWith("npm:example", "project", "observation-failed");
  });

  it("fails closed when a completed mutation cannot commit its durable receipt", async () => {
    const install = vi.fn(async () => MUTATED_LIST);
    const markAmbiguous = vi.fn(async () => undefined);
    const services = workspaceServices({
      commitActive: vi.fn(async () => { throw new Error("receipt write failed"); }),
      markAmbiguous
    });
    const router = createRouter({ install }, [], services);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.install", { source: "npm:example", scope: "project" }),
      "receipt-write-failed"
    )).rejects.toMatchObject({
      code: "RUNTIME_POISONED",
      details: { packageReceiptConsistent: true, packageMutationCompleted: true }
    });
    expect(install).toHaveBeenCalledOnce();
    expect(markAmbiguous).toHaveBeenCalledWith("npm:example", "project", "receipt-write-failed");
  });

  it("only commits an uninstall receipt after the target scope is absent", async () => {
    const uninstall = vi.fn(async () => MUTATED_LIST);
    const commitRemoved = vi.fn(async () => undefined);
    const markAmbiguous = vi.fn(async () => undefined);
    const stillConfigured: ExtensionPackageListResult = {
      items: [{
        source: "npm:example",
        scope: "project",
        enabled: false,
        filtered: true,
        installed: true,
        trustState: "unverified",
        trustReason: "mutation-ambiguous"
      }],
      total: 1
    };
    const services = workspaceServices({ commitRemoved, markAmbiguous });
    const router = createRouter({ uninstall, list: () => stillConfigured }, [], services);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.uninstall", { source: "npm:example", scope: "project" }),
      "uninstall-still-configured"
    )).resolves.toMatchObject({ changed: true, receiptState: "ambiguous" });
    expect(commitRemoved).not.toHaveBeenCalled();
    expect(markAmbiguous).toHaveBeenCalledWith("npm:example", "project", "uninstall-still-configured");
  });

  it("refreshes the other active scope after Pi updates a matching package identity", async () => {
    const update = vi.fn(async () => MUTATED_LIST);
    const commitActive = vi.fn(async () => undefined);
    const refreshActiveObservation = vi.fn(async () => true);
    const services = workspaceServices({ commitActive, refreshActiveObservation });
    const router = createRouter({ update }, [], services);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.update", { source: "npm:example", scope: "project" }),
      "update-both-scopes"
    )).resolves.toMatchObject({ changed: true, receiptState: "active" });
    expect(commitActive).toHaveBeenCalledWith(
      "npm:example",
      "project",
      "update-both-scopes",
      observedPackage(),
      true
    );
    expect(refreshActiveObservation).toHaveBeenCalledWith(
      "npm:example",
      "global",
      observedPackage()
    );
  });
});

function createRouter(
  overrides: Partial<ReturnType<typeof management>> = {},
  tasks: ExtensionPackageTaskView[] = [],
  services: PiWorkspaceRuntimeServices = workspaceServices()
): ExtensionPackageCommandRouter {
  const packages = management(overrides);
  return new ExtensionPackageCommandRouter({
    getWorkspaceServices: () => services,
    listTasks: () => tasks,
    createManagement: () => packages
  });
}

function workspaceServices(
  receiptOverrides: Record<string, unknown> = {},
  trustOverrides: Record<string, unknown> = {}
): PiWorkspaceRuntimeServices {
  return {
    packageMutationReceipts: {
      reserve: vi.fn(async () => ({ status: "reserved", record: {} })),
      markMutating: vi.fn(async () => undefined),
      commitActive: vi.fn(async () => undefined),
      commitRemoved: vi.fn(async () => undefined),
      markAmbiguous: vi.fn(async () => undefined),
      refreshActiveObservation: vi.fn(async () => false),
      ...receiptOverrides
    },
    packageTrustRegistry: {
      refresh: vi.fn(async () => undefined),
      observationFor: vi.fn(() => ({ status: "observed", observation: observedPackage() })),
      ...trustOverrides
    }
  } as unknown as PiWorkspaceRuntimeServices;
}

function observedPackage() {
  return {
    manifestSha256: "1".repeat(64),
    contentSha256: "2".repeat(64),
    directoryIdentityDigest: "3".repeat(64),
    observedAt: 1
  };
}

function management(overrides: Partial<{
  list: () => typeof EMPTY_LIST;
  checkForUpdates: () => Promise<{ items: never[]; total: number }>;
  install: (source: string, scope: "global" | "project") => Promise<typeof MUTATED_LIST>;
  update: (source: string, scope: "global" | "project") => Promise<typeof MUTATED_LIST>;
  setEnabled: (source: string, scope: "global" | "project", enabled: boolean) => Promise<typeof MUTATED_LIST>;
  restoreProjectInheritance: (source: string) => Promise<typeof MUTATED_LIST>;
  uninstall: (source: string, scope: "global" | "project") => Promise<typeof MUTATED_LIST>;
}> = {}) {
  return {
    list: () => EMPTY_LIST,
    checkForUpdates: async () => ({ items: [], total: 0 }),
    install: async () => MUTATED_LIST,
    update: async () => MUTATED_LIST,
    setEnabled: async () => MUTATED_LIST,
    restoreProjectInheritance: async () => MUTATED_LIST,
    uninstall: async () => MUTATED_LIST,
    ...overrides
  };
}

function task(
  workspaceId: string,
  idle: boolean,
  activeRuntime: AgentRuntime = runtime().runtime
): ExtensionPackageTaskView {
  return {
    taskKey: `${workspaceId}:task`,
    workspaceId,
    runtime: activeRuntime,
    initialized: true,
    isIdle: () => idle
  };
}

function runtime(reloadError?: Error): {
  runtime: AgentRuntime;
  reloadResources: ReturnType<typeof vi.fn<AgentRuntime["reloadResources"]>>;
} {
  const reloadResources = vi.fn<AgentRuntime["reloadResources"]>(async () => {
      if (reloadError) throw reloadError;
      return {
        sessionId: "session-a",
        controls: { thinkingLevel: "off" },
        modelCatalog: { models: [], providers: [], availableThinkingLevels: [] },
        resources: []
      };
  });
  return {
    runtime: { reloadResources } as unknown as AgentRuntime,
    reloadResources
  };
}

function command<T extends ExtensionPackageCommandType>(
  type: T,
  payload: AgentCommand<T>["payload"]
): AgentCommand<T> {
  return { type, payload } as AgentCommand<T>;
}
