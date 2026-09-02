import type { ExtensionPackageListResult } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import {
  command,
  createRouter,
  EMPTY_LIST,
  MUTATED_LIST,
  observedPackage,
  runtime,
  task,
  WORKSPACE_A,
  workspaceServices
} from "./extension-package-command-router.test-fixture.js";

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

  it("records content approval while busy Tasks defer reload and idle Tasks reload immediately", async () => {
    let approved = false;
    const approvedList = (): ExtensionPackageListResult => ({
      items: [{
        source: "npm:example",
        scope: "global",
        enabled: true,
        filtered: false,
        installed: true,
        trustState: approved ? "user-approved-observed" : "unverified",
        ...(approved ? {} : { trustReason: "receipt-missing" as const })
      }],
      total: 1
    });
    const reserve = vi.fn(async () => ({ status: "reserved" as const, record: {} }));
    const commitActive = vi.fn(async () => { approved = true; });
    const services = workspaceServices({ reserve, commitActive });
    const busyRuntime = runtime();
    const idleRuntime = runtime();
    const router = createRouter({ list: approvedList }, [
      task("workspace-a", false, busyRuntime.runtime),
      task("workspace-b", true, idleRuntime.runtime)
    ], services);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.approveObserved", { source: "npm:example", scope: "global" }),
      "approve-global"
    )).resolves.toMatchObject({
      changed: true,
      receiptState: "active",
      reloadRequired: true
    });
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ operation: "admit" }));
    expect(commitActive).toHaveBeenCalledWith(
      "npm:example",
      "global",
      "approve-global",
      observedPackage(),
      true
    );
    expect(busyRuntime.reloadResources).not.toHaveBeenCalled();
    expect(idleRuntime.reloadResources).toHaveBeenCalledOnce();
  });

  it("routes the persisted prompt-once status and decline without reloading Tasks", async () => {
    const status = vi.fn(async () => ({
      source: "npm:example-prompt-once",
      scope: "global" as const,
      state: "unseen" as const
    }));
    const decline = vi.fn(async () => ({
      source: "npm:example-prompt-once",
      scope: "global" as const,
      state: "declined" as const
    }));
    const activeRuntime = runtime();
    const services = workspaceServices({}, {}, { status, decline });
    const router = createRouter({}, [task("workspace-a", false, activeRuntime.runtime)], services);

    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.onboarding.get", {
        source: "npm:example-prompt-once",
        scope: "global"
      })
    )).resolves.toMatchObject({ state: "unseen" });
    await expect(router.dispatch(
      WORKSPACE_A,
      command("extension.package.onboarding.decline", {
        source: "npm:example-prompt-once",
        scope: "global"
      }),
      "decline-onboarding"
    )).resolves.toMatchObject({ state: "declined" });
    expect(activeRuntime.reloadResources).not.toHaveBeenCalled();
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
