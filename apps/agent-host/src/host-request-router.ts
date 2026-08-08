import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  isReplaySafeControlMutation,
  type AgentCommand,
  type AgentCommandType,
  type CommandResults,
  type ReplaySafeControlMutationType,
  type RequestEnvelope
} from "@pi67/protocol";
import type { HostConnectionContext } from "./connection-context.js";
import { isContextFileCommand, type ContextFileCommandRouter } from "./context-file-command-router.js";
import { isExtensionPackageCommand, type ExtensionPackageCommandRouter } from "./extension-package-command-router.js";
import { operationSubmissionIdentity } from "./host-command-dispatcher.js";
import type { HostTaskStateCoordinator, TaskHostState } from "./host-task-state-coordinator.js";
import type { OperationRegistry } from "./operation-registry.js";
import { HostCommandError, toProtocolError } from "./protocol-error.js";
import { SessionCreationResolutionCoordinator } from "./session-creation-resolution-coordinator.js";
import { isSkillPackCommand, type SkillPackCommandRouter } from "./skill-pack-command-router.js";
import {
  isWorkspaceLifecycleCommand,
  isWorkspaceConversationCommand,
  isWorkspaceProviderCommand,
  type WorkspaceCommandRouter
} from "./workspace-command-router.js";
import {
  isWorkspaceFileCommand,
  type WorkspaceFileCommandRouter
} from "./workspace-file-command-router.js";
export interface HostRequestRouterOptions {
  isShuttingDown(): boolean;
  runtimeStatus(): CommandResults["runtime.getStatus"];
  dispatchAppCommand(command: AgentCommand): Promise<CommandResults[AgentCommandType]>;
  handleProjectionResync(
    origin: HostConnectionContext,
    request: RequestEnvelope<"projection.resync">,
    state: TaskHostState
  ): Promise<void>;
  loadRuntime(state: TaskHostState): Promise<AgentRuntime>;
  closeTask(state: TaskHostState, mode: "stop" | "dispose"): Promise<CommandResults["task.close"]>;
  dispatchTask(
    command: AgentCommand,
    state: TaskHostState,
    submissionFingerprint?: string
  ): Promise<CommandResults[AgentCommandType]>;
  shutdownResources(deadlineMs?: number): Promise<void>;
}
export class HostRequestRouter {
  private readonly sessionCreationResolutions: SessionCreationResolutionCoordinator;
  constructor(
    private readonly tasks: HostTaskStateCoordinator,
    private readonly contextFiles: ContextFileCommandRouter,
    private readonly extensionPackages: ExtensionPackageCommandRouter,
    private readonly skillPacks: SkillPackCommandRouter,
    private readonly workspaceCommands: WorkspaceCommandRouter,
    private readonly workspaceFiles: WorkspaceFileCommandRouter,
    private readonly options: HostRequestRouterOptions
  ) {
    this.sessionCreationResolutions = new SessionCreationResolutionCoordinator(workspaceCommands);
  }
  async shutdown(deadlineMs?: number): Promise<void> {
    const results = await Promise.allSettled([
      invokeShutdown(() => this.sessionCreationResolutions.shutdown(deadlineMs)),
      invokeShutdown(() => this.options.shutdownResources(deadlineMs)),
      invokeShutdown(() => this.workspaceCommands.shutdown())
    ]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (rejected) throw rejected.reason;
  }
  handle(origin: HostConnectionContext, request: RequestEnvelope): void {
    if (this.options.isShuttingDown()) {
      origin.sendError(request.requestId, request.type, toProtocolError(connectionClosed()));
      return;
    }
    let state: TaskHostState | undefined;
    try {
      state = this.tasks.authorizeRequestContext(request);
    } catch (error) {
      origin.sendError(request.requestId, request.type, toProtocolError(error));
      return;
    }
    if (request.type === "runtime.getStatus") {
      origin.sendSuccess(request.requestId, request.type, this.options.runtimeStatus());
      return;
    }
    if (isWorkspaceLifecycleCommand(request.type)) {
      this.handleWorkspaceLifecycleCommand(origin, request);
      return;
    }
    if (isWorkspaceProviderCommand(request.type)) {
      this.handleWorkspaceProviderCommand(origin, request);
      return;
    }
    if (isWorkspaceConversationCommand(request.type)) {
      this.handleWorkspaceConversationCommand(origin, request);
      return;
    }
    if (request.type === "session.catalog.query" && request.context.scope === "workspace") {
      const command = { type: request.type, payload: request.payload } as AgentCommand<"session.catalog.query">;
      void this.workspaceCommands.queryCatalog(request.context, command)
        .then((result) => origin.sendSuccess(request.requestId, request.type, result))
        .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
      return;
    }
    if (request.type === "session.catalog.contentSearch" && request.context.scope === "workspace") {
      const command = { type: request.type, payload: request.payload } as AgentCommand<"session.catalog.contentSearch">;
      void this.workspaceCommands.searchCatalogContent(request.context, command)
        .then((result) => origin.sendSuccess(request.requestId, request.type, result))
        .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
      return;
    }
    if (request.type === "session.creation.resolve" && request.context.scope === "workspace") {
      const command = {
        type: request.type,
        payload: request.payload
      } as AgentCommand<"session.creation.resolve">;
      void this.sessionCreationResolutions.resolve(
        request.context,
        command,
        origin.signalForRequest(request.requestId)
      )
        .then((result) => origin.sendSuccess(request.requestId, request.type, result))
        .catch((error: unknown) => origin.sendError(
          request.requestId,
          request.type,
          toProtocolError(error)
        ));
      return;
    }
    if (isWorkspaceFileCommand(request.type)) {
      this.handleWorkspaceFileCommand(origin, request);
      return;
    }
    if (isContextFileCommand(request.type)) {
      this.handleContextFileCommand(origin, request);
      return;
    }
    if (isExtensionPackageCommand(request.type)) {
      this.handleExtensionPackageCommand(origin, request);
      return;
    }
    if (isSkillPackCommand(request.type)) {
      this.handleSkillPackCommand(origin, request);
      return;
    }
    if (request.context.scope === "task") {
      try {
        this.extensionPackages.assertTaskCommandAllowed(request.context.workspaceId);
      } catch (error) {
        origin.sendError(request.requestId, request.type, toProtocolError(error));
        return;
      }
    }
    if (request.context.scope === "app") {
      const command = { type: request.type, payload: request.payload } as AgentCommand;
      void this.options.dispatchAppCommand(command)
        .then((result) => sendSuccess(origin, request, result))
        .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
      return;
    }
    if (request.type === "projection.resync") {
      const command = { type: request.type, payload: request.payload } as AgentCommand;
      void this.tasks.requireScheduler(state)
        .run(command, () => this.options.handleProjectionResync(
          origin,
          request as RequestEnvelope<"projection.resync">,
          this.tasks.requireState(state)
        ))
        .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
      return;
    }
    if (request.type === "queue.clear") {
      this.handleQueueClear(
        origin,
        request as RequestEnvelope<"queue.clear">,
        this.tasks.requireState(state)
      );
      return;
    }
    this.handleTaskCommand(origin, request, state);
  }

  private handleContextFileCommand(
    origin: HostConnectionContext,
    request: RequestEnvelope
  ): void {
    if (!isContextFileCommand(request.type) || request.context.scope !== "workspace") {
      origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError(
        "INVALID_PAYLOAD",
        "Context file commands require Workspace authority.",
        false
      )));
      return;
    }
    const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
    void this.contextFiles.dispatch(request.context, command, request.idempotencyKey)
      .then((result) => sendSuccess(origin, request, result))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }

  private handleWorkspaceFileCommand(
    origin: HostConnectionContext,
    request: RequestEnvelope
  ): void {
    if (!isWorkspaceFileCommand(request.type) || request.context.scope !== "workspace") {
      origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError(
        "INVALID_PAYLOAD",
        "Workspace file commands require Workspace authority.",
        false
      )));
      return;
    }
    const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
    void this.workspaceFiles.dispatch(request.context, command, request.idempotencyKey)
      .then((result) => sendSuccess(origin, request, result))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }

  private handleWorkspaceProviderCommand(
    origin: HostConnectionContext,
    request: RequestEnvelope
  ): void {
    if (!isWorkspaceProviderCommand(request.type) || request.context.scope !== "workspace") {
      origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError(
        "INVALID_PAYLOAD",
        "Provider commands require Workspace authority.",
        false
      )));
      return;
    }
    const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
    void this.workspaceCommands.dispatchProvider(request.context, command, request.idempotencyKey)
      .then((result) => sendSuccess(origin, request, result))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }

  private handleWorkspaceConversationCommand(
    origin: HostConnectionContext,
    request: RequestEnvelope
  ): void {
    if (!isWorkspaceConversationCommand(request.type) || request.context.scope !== "workspace") {
      origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError(
        "INVALID_PAYLOAD",
        "Conversation organization commands require Workspace authority.",
        false
      )));
      return;
    }
    const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
    void this.workspaceCommands.dispatchConversation(request.context, command, request.idempotencyKey)
      .then((result) => sendSuccess(origin, request, result))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }

  private handleWorkspaceLifecycleCommand(
    origin: HostConnectionContext,
    request: RequestEnvelope
  ): void {
    if (!isWorkspaceLifecycleCommand(request.type) || request.context.scope !== "workspace") {
      origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError(
        "INVALID_PAYLOAD",
        "Workspace lifecycle commands require Workspace authority.",
        false
      )));
      return;
    }
    const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
    void this.workspaceCommands.dispatch(request.context, command, request.idempotencyKey)
      .then((result) => sendSuccess(origin, request, result))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }

  private handleExtensionPackageCommand(
    origin: HostConnectionContext,
    request: RequestEnvelope
  ): void {
    if (!isExtensionPackageCommand(request.type) || request.context.scope !== "workspace") {
      origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError(
        "INVALID_PAYLOAD",
        "Extension package commands require Workspace authority.",
        false
      )));
      return;
    }
    const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
    void this.extensionPackages.dispatch(request.context, command, request.idempotencyKey)
      .then((result) => sendSuccess(origin, request, result))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }

  private handleSkillPackCommand(
    origin: HostConnectionContext,
    request: RequestEnvelope
  ): void {
    if (!isSkillPackCommand(request.type) || request.context.scope !== "workspace") {
      origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError(
        "INVALID_PAYLOAD",
        "Skill Pack commands require Workspace authority.",
        false
      )));
      return;
    }
    const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
    void this.skillPacks.dispatch(request.context, command, request.idempotencyKey)
      .then((result) => sendSuccess(origin, request, result))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }

  private handleQueueClear(
    origin: HostConnectionContext,
    request: RequestEnvelope<"queue.clear">,
    state: TaskHostState
  ): void {
    const scheduler = this.tasks.requireScheduler(state);
    void scheduler.clearQueue(async () => {
      const runtime = await this.options.loadRuntime(state);
      return runtime.clearQueue();
    }).then(
      ({ pendingCount, result }) => origin.sendSuccess(request.requestId, request.type, {
        ...result,
        pendingCount
      }),
      (error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error))
    );
  }

  private handleTaskCommand(
    origin: HostConnectionContext,
    request: RequestEnvelope,
    state: TaskHostState | undefined
  ): void {
    const command = { type: request.type, payload: request.payload } as AgentCommand;
    if (command.type === "task.close") {
      this.handleTaskClose(origin, request, command, this.tasks.requireState(state));
      return;
    }
    const submission = operationSubmissionIdentity(command);
    if (submission && this.replaySubmission(origin, request, state, submission)) return;
    const taskState = this.tasks.requireState(state);
    const scheduler = this.tasks.requireScheduler(taskState);
    if (isReplaySafeControlMutation(request.type)) {
      this.handleControlMutation(origin, request, command, taskState, scheduler);
      return;
    }
    void scheduler.run(command, () => this.options.dispatchTask(command, taskState, submission?.fingerprint))
      .then((result) => sendSuccess(origin, request, result))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }

  private handleTaskClose(
    origin: HostConnectionContext,
    request: RequestEnvelope,
    command: AgentCommand<"task.close">,
    state: TaskHostState
  ): void {
    if (!request.idempotencyKey) {
      sendMissingIdempotencyKey(origin, request);
      return;
    }
    let closeResult: Promise<CommandResults["task.close"]>;
    try {
      closeResult = this.tasks.requireControlMutationLedger(state).run(
        request.idempotencyKey,
        command,
        () => this.options.closeTask(state, command.payload.mode)
      ) as Promise<CommandResults["task.close"]>;
    } catch (error) {
      origin.sendError(request.requestId, request.type, toProtocolError(error));
      return;
    }
    void closeResult.then(
      (result) => origin.sendSuccess(request.requestId, request.type, result),
      (error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error))
    );
  }

  private replaySubmission(
    origin: HostConnectionContext,
    request: RequestEnvelope,
    state: TaskHostState | undefined,
    submission: NonNullable<ReturnType<typeof operationSubmissionIdentity>>
  ): boolean {
    let existing: ReturnType<OperationRegistry["submissionFor"]>;
    try {
      existing = state?.operations?.submissionFor(submission.submissionId, submission.fingerprint);
    } catch (error) {
      origin.sendError(request.requestId, request.type, toProtocolError(error));
      return true;
    }
    if (!existing) return false;
    void Promise.resolve(existing).then(
      (accepted) => origin.sendSuccess(request.requestId, request.type, accepted),
      (error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error))
    );
    return true;
  }

  private handleControlMutation(
    origin: HostConnectionContext,
    request: RequestEnvelope,
    command: AgentCommand,
    state: TaskHostState,
    scheduler: ReturnType<HostTaskStateCoordinator["requireScheduler"]>
  ): void {
    if (!request.idempotencyKey) {
      sendMissingIdempotencyKey(origin, request);
      return;
    }
    let result: Promise<CommandResults[AgentCommandType]>;
    try {
      const controlCommand = command as AgentCommand<ReplaySafeControlMutationType>;
      result = this.tasks.requireControlMutationLedger(state).run(
        request.idempotencyKey,
        controlCommand,
        () => scheduler.run(controlCommand, () => this.options.dispatchTask(controlCommand, state))
      );
    } catch (error) {
      origin.sendError(request.requestId, request.type, toProtocolError(error));
      return;
    }
    void result
      .then((response) => sendSuccess(origin, request, response))
      .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  }
}

function sendMissingIdempotencyKey(origin: HostConnectionContext, request: RequestEnvelope): void {
  origin.sendError(request.requestId, request.type, {
    code: "INVALID_PAYLOAD",
    message: "Replay-safe control mutations require an idempotency key.",
    recoverable: false
  });
}

function sendSuccess(
  origin: HostConnectionContext,
  request: RequestEnvelope,
  result: CommandResults[AgentCommandType]
): void {
  origin.sendSuccess(request.requestId, request.type, result as never);
}

function connectionClosed(): HostCommandError {
  return new HostCommandError(
    "CONNECTION_CLOSED",
    "The Pi runtime service is shutting down.",
    true,
    { shuttingDown: true }
  );
}

function invokeShutdown(operation: () => Promise<void>): Promise<void> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}
