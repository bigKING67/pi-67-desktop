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

  it("rejects waiters and returns immediately when the Host shuts down", async () => {
    let scanSignal: AbortSignal | undefined;
    const coordinator = coordinatorWith(vi.fn((
      _context: WorkspaceProtocolContext,
      _command: ResolveCommand,
      options: { signal?: AbortSignal }
    ) => {
      scanSignal = options.signal;
      return new Promise<Resolution>(() => undefined);
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

    coordinator.shutdown();

    expect(scanSignal?.aborted).toBe(true);
    await rejected;
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
} {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => { resolve = done; }),
    resolve
  };
}
