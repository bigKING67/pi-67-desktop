import type {
  AgentCommand,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import type { HostConnectionContext } from "./connection-context.js";
import { HostRequestRouter } from "./host-request-router.js";
import { commandEnvelopeForContext } from "./protocol-test-fixtures.js";
import type { WorkspaceCommandRouter } from "./workspace-command-router.js";

const WORKSPACE: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-shutdown"
};

describe("HostRequestRouter shutdown", () => {
  it("starts every downstream shutdown concurrently and waits for Session resolution drain", async () => {
    const scan = deferred<Resolution>();
    const resources = deferred<void>();
    const workspaces = deferred<void>();
    let scanSignal: AbortSignal | undefined;
    const resolveSessionCreation = vi.fn((
      _context: WorkspaceProtocolContext,
      _command: ResolveCommand,
      options: { signal?: AbortSignal }
    ) => {
      scanSignal = options.signal;
      return scan.promise;
    });
    const shutdownResources = vi.fn(() => resources.promise);
    const shutdownWorkspaces = vi.fn(() => workspaces.promise);
    const router = createRouter(resolveSessionCreation, shutdownResources, shutdownWorkspaces);
    const sendError = vi.fn();
    const origin = {
      sendError,
      sendSuccess: vi.fn(),
      signalForRequest: vi.fn(() => new AbortController().signal)
    } as unknown as HostConnectionContext;
    router.handle(origin, commandEnvelopeForContext(
      "session.creation.resolve",
      { creationId: "creation-router-shutdown" },
      WORKSPACE
    ));
    await vi.waitFor(() => expect(resolveSessionCreation).toHaveBeenCalledOnce());

    let shutdownSettled = false;
    const shutdown = router.shutdown(500).finally(() => { shutdownSettled = true; });

    await vi.waitFor(() => {
      expect(shutdownResources).toHaveBeenCalledWith(500);
      expect(shutdownWorkspaces).toHaveBeenCalledOnce();
      expect(sendError).toHaveBeenCalledWith(
        expect.any(String),
        "session.creation.resolve",
        expect.objectContaining({ code: "CONNECTION_CLOSED" })
      );
    });
    expect(scanSignal?.aborted).toBe(true);
    resources.resolve();
    workspaces.resolve();
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    scan.resolve({ status: "missing", creationId: "creation-router-shutdown" });
    await expect(shutdown).resolves.toBeUndefined();
  });

  it("throws the first shutdown failure in the fixed resolution-resource-workspace order", async () => {
    const resourceFailure = new Error("resource shutdown failed");
    const workspaceFailure = new Error("workspace shutdown failed");
    const router = createRouter(
      vi.fn(async (_context, command) => ({
        status: "missing" as const,
        creationId: command.payload.creationId
      })),
      vi.fn(async () => { throw resourceFailure; }),
      vi.fn(async () => { throw workspaceFailure; })
    );

    await expect(router.shutdown(500)).rejects.toBe(resourceFailure);
  });
});

type Resolution = CommandResults["session.creation.resolve"];
type ResolveCommand = AgentCommand<"session.creation.resolve">;

function createRouter(
  resolveSessionCreation: (
    context: WorkspaceProtocolContext,
    command: ResolveCommand,
    options: { signal?: AbortSignal }
  ) => Promise<Resolution>,
  shutdownResources: (deadlineMs?: number) => Promise<void>,
  shutdownWorkspaces: () => Promise<void>
): HostRequestRouter {
  const workspaceCommands = {
    resolveSessionCreation,
    shutdown: shutdownWorkspaces
  } as unknown as WorkspaceCommandRouter;
  return new HostRequestRouter(
    { authorizeRequestContext: vi.fn(() => undefined) } as never,
    {} as never,
    {} as never,
    {} as never,
    workspaceCommands,
    {} as never,
    {
      isShuttingDown: () => false,
      runtimeStatus: vi.fn(),
      dispatchAppCommand: vi.fn(),
      handleProjectionResync: vi.fn(),
      loadRuntime: vi.fn(),
      closeTask: vi.fn(),
      dispatchTask: vi.fn(),
      shutdownResources
    } as never
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  return {
    promise: new Promise<T>((done) => { resolve = done; }),
    resolve
  };
}
