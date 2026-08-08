import type {
  AgentCommand,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  SessionCreationResolutionCoordinator
} from "./session-creation-resolution-coordinator.js";
import type { WorkspaceCommandRouter } from "./workspace-command-router.js";

const WORKSPACE_A: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-a"
};
const WORKSPACE_B: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-b"
};

describe("SessionCreationResolutionCoordinator", () => {
  it("runs one scan for 100 waiters on the same Workspace creation identity", async () => {
    const scan = deferred<Resolution>();
    const resolveSessionCreation = vi.fn(() => scan.promise);
    const coordinator = coordinatorWith(resolveSessionCreation);
    const controllers = Array.from({ length: 100 }, () => new AbortController());
    const resolutions = controllers.map((controller) => coordinator.resolve(
      WORKSPACE_A,
      command("creation-shared"),
      controller.signal
    ));
    await vi.waitFor(() => expect(resolveSessionCreation).toHaveBeenCalledOnce());

    scan.resolve(missing("creation-shared"));

    await expect(Promise.all(resolutions)).resolves.toEqual(
      Array.from({ length: 100 }, () => missing("creation-shared"))
    );
    expect(resolveSessionCreation).toHaveBeenCalledOnce();
  });

  it("fails closed when distinct active and queued jobs reach the total limit", async () => {
    const scans = new Map<string, ReturnType<typeof deferred<Resolution>>>();
    const resolveSessionCreation = vi.fn((
      _context: WorkspaceProtocolContext,
      resolveCommand: ResolveCommand
    ) => {
      const scan = deferred<Resolution>();
      scans.set(resolveCommand.payload.creationId, scan);
      return scan.promise;
    });
    const coordinator = coordinatorWith(resolveSessionCreation, {
      maxActive: 1,
      maxActivePerWorkspace: 1,
      maxPendingJobs: 2
    });
    const first = coordinator.resolve(
      WORKSPACE_A,
      command("creation-1"),
      new AbortController().signal
    );
    const second = coordinator.resolve(
      WORKSPACE_B,
      command("creation-2"),
      new AbortController().signal
    );

    await expect(coordinator.resolve(
      WORKSPACE_A,
      command("creation-3"),
      new AbortController().signal
    )).rejects.toMatchObject({
      code: "RESOURCE_LIMIT_EXCEEDED",
      details: { maxPendingJobs: 2 }
    });

    await vi.waitFor(() => expect(resolveSessionCreation).toHaveBeenCalledTimes(1));
    scans.get("creation-1")?.resolve(missing("creation-1"));
    await expect(first).resolves.toEqual(missing("creation-1"));
    await vi.waitFor(() => expect(resolveSessionCreation).toHaveBeenCalledTimes(2));
    scans.get("creation-2")?.resolve(missing("creation-2"));
    await expect(second).resolves.toEqual(missing("creation-2"));
  });

  it("keeps a shared scan alive while at least one waiter remains", async () => {
    const scan = deferred<Resolution>();
    let scanSignal: AbortSignal | undefined;
    const coordinator = coordinatorWith(vi.fn((
      _context: WorkspaceProtocolContext,
      _command: ResolveCommand,
      options: { signal?: AbortSignal }
    ) => {
      scanSignal = options.signal;
      return scan.promise;
    }));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = coordinator.resolve(
      WORKSPACE_A,
      command("creation-shared"),
      firstController.signal
    );
    const second = coordinator.resolve(
      WORKSPACE_A,
      command("creation-shared"),
      secondController.signal
    );
    const firstRejected = expect(first).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await vi.waitFor(() => expect(scanSignal).toBeDefined());

    firstController.abort();

    await firstRejected;
    expect(scanSignal?.aborted).toBe(false);
    scan.resolve(missing("creation-shared"));
    await expect(second).resolves.toEqual(missing("creation-shared"));
  });

  it("aborts the underlying scan after every waiter disconnects", async () => {
    let scanSignal: AbortSignal | undefined;
    const coordinator = coordinatorWith(vi.fn((
      _context: WorkspaceProtocolContext,
      _command: ResolveCommand,
      options: { signal?: AbortSignal }
    ) => {
      scanSignal = options.signal;
      return new Promise<Resolution>(() => undefined);
    }));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = coordinator.resolve(
      WORKSPACE_A,
      command("creation-shared"),
      firstController.signal
    );
    const second = coordinator.resolve(
      WORKSPACE_A,
      command("creation-shared"),
      secondController.signal
    );
    const firstRejected = expect(first).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    const secondRejected = expect(second).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await vi.waitFor(() => expect(scanSignal).toBeDefined());

    firstController.abort();
    secondController.abort();

    await Promise.all([firstRejected, secondRejected]);
    expect(scanSignal?.aborted).toBe(true);
  });

  it("rejects waiters immediately but drains the underlying scan before shutdown completes", async () => {
    const scan = deferred<Resolution>();
    let scanSignal: AbortSignal | undefined;
    const coordinator = coordinatorWith(vi.fn((
      _context: WorkspaceProtocolContext,
      _command: ResolveCommand,
      options: { signal?: AbortSignal }
    ) => {
      scanSignal = options.signal;
      return scan.promise;
    }));
    const pending = coordinator.resolve(
      WORKSPACE_A,
      command("creation-shutdown"),
      new AbortController().signal
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CONNECTION_CLOSED",
      details: { shuttingDown: true }
    });
    await vi.waitFor(() => expect(scanSignal).toBeDefined());

    let shutdownSettled = false;
    const shutdown = coordinator.shutdown(500).finally(() => { shutdownSettled = true; });

    expect(scanSignal?.aborted).toBe(true);
    await rejected;
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    scan.resolve(missing("creation-shutdown"));
    await expect(shutdown).resolves.toBeUndefined();
  });

  it("drains normally when the underlying scan rejects after observing abort", async () => {
    let observedAbort = false;
    const coordinator = coordinatorWith(vi.fn((
      _context: WorkspaceProtocolContext,
      _command: ResolveCommand,
      options: { signal?: AbortSignal }
    ) => new Promise<Resolution>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        observedAbort = true;
        reject(new Error("scan aborted"));
      }, { once: true });
    })));
    const pending = coordinator.resolve(
      WORKSPACE_A,
      command("creation-abort"),
      new AbortController().signal
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CONNECTION_CLOSED",
      details: { shuttingDown: true }
    });
    await Promise.resolve();

    const shutdown = coordinator.shutdown(500);

    await rejected;
    await expect(shutdown).resolves.toBeUndefined();
    expect(observedAbort).toBe(true);
  });

  it("drops queued scans while rejecting both active and queued waiters", async () => {
    const activeScan = deferred<Resolution>();
    const resolveSessionCreation = vi.fn(() => activeScan.promise);
    const coordinator = coordinatorWith(resolveSessionCreation, {
      maxActive: 1,
      maxActivePerWorkspace: 1
    });
    const active = coordinator.resolve(
      WORKSPACE_A,
      command("creation-active"),
      new AbortController().signal
    );
    const queued = coordinator.resolve(
      WORKSPACE_B,
      command("creation-queued"),
      new AbortController().signal
    );
    const activeRejected = expect(active).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    const queuedRejected = expect(queued).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await vi.waitFor(() => expect(resolveSessionCreation).toHaveBeenCalledOnce());

    const shutdown = coordinator.shutdown(500);

    await Promise.all([activeRejected, queuedRejected]);
    expect(resolveSessionCreation).toHaveBeenCalledOnce();
    activeScan.resolve(missing("creation-active"));
    await expect(shutdown).resolves.toBeUndefined();
    expect(resolveSessionCreation).toHaveBeenCalledOnce();
  });

  it("returns the same shutdown Promise for repeated calls", async () => {
    const scan = deferred<Resolution>();
    const coordinator = coordinatorWith(vi.fn(() => scan.promise));
    const pending = coordinator.resolve(
      WORKSPACE_A,
      command("creation-repeat"),
      new AbortController().signal
    );
    const rejected = expect(pending).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await Promise.resolve();

    const first = coordinator.shutdown(500);
    const second = coordinator.shutdown(20);

    expect(second).toBe(first);
    await rejected;
    scan.resolve(missing("creation-repeat"));
    await expect(first).resolves.toBeUndefined();
  });

  it("rejects invalid shutdown deadlines without closing admission", async () => {
    const resolveSessionCreation = vi.fn(async (
      _context: WorkspaceProtocolContext,
      resolveCommand: ResolveCommand
    ) => missing(resolveCommand.payload.creationId));
    const coordinator = coordinatorWith(resolveSessionCreation);

    await expect(coordinator.shutdown(0)).rejects.toThrow(
      "Session creation resolution shutdown deadline must be between 1 and 10000 milliseconds."
    );
    await expect(coordinator.resolve(
      WORKSPACE_A,
      command("creation-after-invalid-deadline"),
      new AbortController().signal
    )).resolves.toEqual(missing("creation-after-invalid-deadline"));
    await expect(coordinator.shutdown(500)).resolves.toBeUndefined();
  });

  it("poisons a shutdown whose scan outlives the deadline and stays closed after late settle", async () => {
    const scan = deferred<Resolution>();
    const resolveSessionCreation = vi.fn(() => scan.promise);
    const coordinator = coordinatorWith(resolveSessionCreation);
    const pending = coordinator.resolve(
      WORKSPACE_A,
      command("creation-timeout"),
      new AbortController().signal
    );
    const rejected = expect(pending).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await vi.waitFor(() => expect(resolveSessionCreation).toHaveBeenCalledOnce());

    const shutdown = coordinator.shutdown(20);

    await rejected;
    await expect(shutdown).rejects.toMatchObject({
      code: "RUNTIME_POISONED",
      recoverable: false,
      details: { sessionCreationResolutionShutdown: false }
    });
    scan.resolve(missing("creation-timeout"));
    await Promise.resolve();
    await expect(coordinator.resolve(
      WORKSPACE_A,
      command("creation-after-timeout"),
      new AbortController().signal
    )).rejects.toMatchObject({
      code: "CONNECTION_CLOSED",
      details: { shuttingDown: true }
    });
    expect(resolveSessionCreation).toHaveBeenCalledOnce();
  });
});

type Resolution = CommandResults["session.creation.resolve"];
type ResolveCommand = AgentCommand<"session.creation.resolve">;

function coordinatorWith(
  resolveSessionCreation: (
    context: WorkspaceProtocolContext,
    command: ResolveCommand,
    options: { signal?: AbortSignal }
  ) => Promise<Resolution>,
  options: ConstructorParameters<typeof SessionCreationResolutionCoordinator>[1] = {}
): SessionCreationResolutionCoordinator {
  return new SessionCreationResolutionCoordinator(
    { resolveSessionCreation } as Pick<WorkspaceCommandRouter, "resolveSessionCreation">,
    options
  );
}

function command(creationId: string): ResolveCommand {
  return { type: "session.creation.resolve", payload: { creationId } };
}

function missing(creationId: string): Resolution {
  return { status: "missing", creationId };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  return {
    promise: new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    }),
    resolve,
    reject
  };
}
