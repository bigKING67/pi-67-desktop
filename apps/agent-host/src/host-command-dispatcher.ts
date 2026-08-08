import type { AgentRuntime } from "@pi67/pi-runtime";
import type {
  AgentCommand,
  AgentEvent,
  CommandResults,
  ProjectionMutationAcknowledgement
} from "@pi67/protocol";
import type { OperationRegistry } from "./operation-registry.js";
import {
  promptSubmissionFingerprint,
  textOperationSubmissionIdentity
} from "./operation-submission-identity.js";
import { HostCommandError } from "./protocol-error.js";

export { operationSubmissionIdentity } from "./operation-submission-identity.js";

export type RuntimeLoadedCommand = Exclude<
  AgentCommand,
  {
    type:
      | "runtime.getStatus"
      | "queue.clear"
      | "task.close"
      | "workspace.register"
      | "workspace.unregister"
      | "workspace.file.list"
      | "workspace.file.search"
      | "workspace.file.resolve"
      | "workspace.file.open"
      | "workspace.file.save"
      | "workspace.file.create"
      | "workspace.file.rename"
      | "provider.list"
      | "provider.setRuntimeKey"
      | "provider.configuration.get"
      | "provider.configuration.save"
      | "provider.configuration.remove"
      | "provider.credential.store"
      | "provider.credential.reveal"
      | "provider.credential.remove"
      | "model.default.set"
      | "provider.configuration.reload"
      | "context.file.list"
      | "context.file.read"
      | "context.file.save"
      | "extension.package.list"
      | "extension.package.checkUpdates"
      | "extension.package.install"
      | "extension.package.update"
      | "extension.package.approveObserved"
      | "extension.package.onboarding.get"
      | "extension.package.onboarding.decline"
      | "extension.package.setEnabled"
      | "extension.package.restoreInheritance"
      | "extension.package.uninstall"
      | "skill.pack.list"
      | "skill.pack.checkUpdates"
      | "skill.pack.update"
      | "skill.pack.restore"
      | "session.creation.resolve"
      | "session.catalog.contentSearch"
      | "session.nameByPath"
      | "conversation.pin"
      | "conversation.archive"
      | "conversation.snooze"
      | "conversation.reorderPinned"
  }
>;

interface HostCommandDispatchContext {
  captureProjectionResync: (runtime: AgentRuntime) => CommandResults["projection.resync"];
  captureProjectionMutationAcknowledgement: (
    runtime: AgentRuntime
  ) => ProjectionMutationAcknowledgement;
  initializeRuntime: (
    runtime: AgentRuntime,
    options: Parameters<AgentRuntime["initialize"]>[0]
  ) => Promise<CommandResults["runtime.initialize"]>;
  forkSessionFromTask: (
    runtime: AgentRuntime,
    payload: Extract<AgentCommand, { type: "session.forkFromTask" }>["payload"]
  ) => Promise<ReturnType<AgentRuntime["getSnapshot"]>>;
  commitSessionWriter: (runtime: AgentRuntime) => Promise<void>;
  operations: () => OperationRegistry;
  completeInteractiveWait: (requestId: string) => void;
  reuseInitializedSessionForCreate?: boolean;
  sendEvent: (event: AgentEvent) => void;
}

export async function dispatchHostCommand(
  runtime: AgentRuntime,
  command: RuntimeLoadedCommand,
  context: HostCommandDispatchContext,
  submissionFingerprint?: string
): Promise<CommandResults[RuntimeLoadedCommand["type"]]> {
  switch (command.type) {
    case "runtime.initialize":
      return context.initializeRuntime(runtime, command.payload);
    case "projection.resync":
      return context.captureProjectionResync(runtime);
    case "workspace.open":
      return context.initializeRuntime(runtime, command.payload);
    case "workspace.setTrust":
      {
        const previousMode = runtime.getTaskToolMode();
        const taskToolMode = runtime.setWorkspacePolicy(
          command.payload.trust,
          command.payload.approvalMode
        );
        const result = await runtime.reloadResources();
        if (taskToolMode !== previousMode) {
          context.sendEvent({
            type: "task.toolMode.changed",
            payload: { mode: taskToolMode, reason: "trust-revoked" }
          });
        }
        return result;
      }
    case "workspace.changes":
      return runtime.getWorkspaceChanges();
    case "task.toolMode.set": {
      const mode = runtime.setTaskToolMode(command.payload.mode);
      context.sendEvent({
        type: "task.toolMode.changed",
        payload: { mode, reason: "user-selected" }
      });
      return { mode };
    }
    case "session.catalog.query":
      return runtime.querySessionCatalog(command.payload);
    case "session.tree":
      return runtime.getSessionTree();
    case "message.page":
      return runtime.getMessagePage(command.payload);
    case "message.index":
      return runtime.getUserMessageIndex(command.payload);
    case "message.search":
      return runtime.searchMessages(command.payload.query);
    case "message.locate":
      return runtime.locateMessage(command.payload.id);
    case "asset.read": {
      const identity = runtime.getIdentity();
      if (identity.sessionGeneration !== command.payload.sessionGeneration) {
        throw new HostCommandError(
          "STALE_SESSION_GENERATION",
          "The requested asset belongs to a stale session generation.",
          true,
          {
            expectedSessionGeneration: identity.sessionGeneration,
            receivedSessionGeneration: command.payload.sessionGeneration
          }
        );
      }
      return runtime.readAsset(command.payload);
    }
    case "session.create": {
      const snapshot = context.reuseInitializedSessionForCreate
        ? runtime.getSnapshot()
        : await runtime.createSession(command.payload.creationId);
      if (!context.reuseInitializedSessionForCreate) await context.commitSessionWriter(runtime);
      context.sendEvent({ type: "session.bootstrap", payload: { snapshot, reason: "session-create" } });
      return context.captureProjectionMutationAcknowledgement(runtime);
    }
    case "session.open": {
      const snapshot = await runtime.openSession(command.payload.path, command.payload.cwdOverride);
      await context.commitSessionWriter(runtime);
      context.sendEvent({ type: "session.bootstrap", payload: { snapshot, reason: "session-open" } });
      return context.captureProjectionMutationAcknowledgement(runtime);
    }
    case "session.import": {
      const submission = textOperationSubmissionIdentity(
        command.payload.submissionId,
        command.type,
        command.payload.path
      );
      return context.operations().accept({
        submissionId: submission.submissionId,
        fingerprint: submissionFingerprint ?? submission.fingerprint,
        kind: "session-import",
        execute: async () => {
          const authorityBefore = runtime.getIdentity();
          let snapshot;
          try {
            snapshot = await runtime.importSession(command.payload.path);
          } catch (error) {
            const authorityAfter = runtime.getIdentity();
            if (
              authorityAfter.sessionId !== undefined
              && (
                authorityAfter.sessionId !== authorityBefore.sessionId
                || authorityAfter.sessionGeneration !== authorityBefore.sessionGeneration
              )
            ) {
              await context.commitSessionWriter(runtime);
              try {
                context.sendEvent({
                  type: "session.bootstrap",
                  payload: { snapshot: runtime.getSnapshot(), reason: "session-import" }
                });
              } catch {
                await context.operations().poisonSessionImportProjection();
                throw new HostCommandError(
                  "RUNTIME_POISONED",
                  "The imported Pi Session became authoritative, but the Pi runtime service could not capture its projection.",
                  true,
                  { hostReplacementRequired: true }
                );
              }
            }
            throw error;
          }
          await context.commitSessionWriter(runtime);
          context.sendEvent({ type: "session.bootstrap", payload: { snapshot, reason: "session-import" } });
        }
      });
    }
    case "session.fork": {
      const snapshot = await runtime.forkSession(
        command.payload.entryId,
        command.payload.position ?? "at"
      );
      await context.commitSessionWriter(runtime);
      context.sendEvent({ type: "session.bootstrap", payload: { snapshot, reason: "session-fork" } });
      return context.captureProjectionMutationAcknowledgement(runtime);
    }
    case "session.forkFromTask": {
      const snapshot = await context.forkSessionFromTask(runtime, command.payload);
      await context.commitSessionWriter(runtime);
      context.sendEvent({ type: "session.bootstrap", payload: { snapshot, reason: "session-fork" } });
      return context.captureProjectionMutationAcknowledgement(runtime);
    }
    case "session.rollback":
      await runtime.rollback(command.payload.entryId, command.payload.summarize);
      return context.captureProjectionMutationAcknowledgement(runtime);
    case "session.compact": {
      const submission = textOperationSubmissionIdentity(
        command.payload.submissionId,
        command.type,
        command.payload.instructions ?? ""
      );
      return context.operations().accept({
        submissionId: submission.submissionId,
        fingerprint: submissionFingerprint ?? submission.fingerprint,
        kind: "compaction",
        execute: async () => {
          await runtime.compact(command.payload.instructions);
        },
        abort: () => runtime.abort(),
        beforeTerminal: () => runtime.flushStream()
      });
    }
    case "session.name":
      await runtime.setSessionName(
        command.payload.mutation.action === "set" ? command.payload.mutation.name : undefined
      );
      return context.captureProjectionMutationAcknowledgement(runtime);
    case "session.interactionMode.set":
      await runtime.setInteractionMode(command.payload.mode);
      return context.captureProjectionMutationAcknowledgement(runtime);
    case "plan.implement": {
      const submission = textOperationSubmissionIdentity(
        command.payload.submissionId,
        command.type,
        command.payload.planId
      );
      return context.operations().accept({
        submissionId: submission.submissionId,
        fingerprint: submissionFingerprint ?? submission.fingerprint,
        kind: "prompt",
        execute: () => runtime.implementPlan(command.payload.planId),
        abort: () => runtime.abort(),
        beforeTerminal: () => runtime.flushStream()
      });
    }
    case "prompt.submit": {
      const operations = context.operations();
      const fingerprint = submissionFingerprint ?? promptSubmissionFingerprint(command.payload);
      const attachmentRefs = command.payload.attachments ?? [];
      const attachments = attachmentRefs.length === 0
        ? undefined
        : await runtime.preparePromptAttachments(
            command.payload.submissionId,
            attachmentRefs
          );
      if (command.payload.delivery === "steer") {
        return operations.queueForActive(
          command.payload.submissionId,
          fingerprint,
          () => runtime.steer(command.payload.text, attachments)
        );
      }
      if (command.payload.delivery === "follow-up") {
        return operations.queueForActive(
          command.payload.submissionId,
          fingerprint,
          () => runtime.followUp(command.payload.text, attachments)
        );
      }
      return operations.accept({
        submissionId: command.payload.submissionId,
        fingerprint,
        kind: "prompt",
        execute: () => runtime.submitPrompt(command.payload.text, attachments),
        abort: () => runtime.abort(),
        beforeTerminal: () => runtime.flushStream()
      });
    }
    case "prompt.steer":
      await runtime.steer(command.payload.text);
      return { accepted: true };
    case "prompt.followUp":
      await runtime.followUp(command.payload.text);
      return { accepted: true };
    case "operation.abort":
      return context.operations().abort(command.payload.operationId);
    case "model.list":
      return runtime.getModels();
    case "model.select":
      return runtime.selectModel(command.payload.provider, command.payload.id);
    case "model.setRuntimeKey":
      return runtime.setRuntimeApiKey(command.payload.provider, command.payload.apiKey);
    case "thinking.set":
      return runtime.setThinkingLevel(command.payload.level);
    case "resource.list":
      return runtime.getResources();
    case "resource.reload":
      return runtime.reloadResources();
    case "command.list":
      return runtime.getCommands();
    case "command.invoke": {
      const submission = textOperationSubmissionIdentity(
        command.payload.submissionId,
        command.type,
        command.payload.command
      );
      return context.operations().accept({
        submissionId: submission.submissionId,
        fingerprint: submissionFingerprint ?? submission.fingerprint,
        kind: "command",
        execute: () => runtime.invokeCommand(command.payload.command),
        beforeTerminal: () => runtime.flushStream()
      });
    }
    case "extension.catalog.list":
      return runtime.getExtensionCatalog();
    case "extension.ui.respond":
      assertInteractiveResponseContext(runtime, context.operations(), command.payload);
      return interactiveResponse(
        command.payload.requestId,
        runtime.resolveExtensionUi(
          command.payload.requestId,
          command.payload.value,
          command.payload.cancelled
        ),
        context.completeInteractiveWait
      );
    case "approval.respond":
      assertInteractiveResponseContext(runtime, context.operations(), command.payload);
      {
        const previousMode = runtime.getTaskToolMode();
        const resolution = runtime.resolveApproval(
          command.payload.requestId,
          command.payload.toolCallId,
          command.payload.decision
        );
        if (resolution.resolved) context.completeInteractiveWait(command.payload.requestId);
        if (resolution.taskToolMode !== previousMode) {
          context.sendEvent({
            type: "task.toolMode.changed",
            payload: {
              mode: resolution.taskToolMode,
              reason: "approval-enabled-yolo"
            }
          });
        }
        return resolution;
      }
    case "diagnostics.collect":
      return runtime.collectDiagnostics();
    case "doctor.run":
      return runtime.runDoctor();
  }
}

function interactiveResponse(
  requestId: string,
  resolved: boolean,
  completeInteractiveWait: (requestId: string) => void
): { resolved: boolean } {
  if (resolved) completeInteractiveWait(requestId);
  return { resolved };
}

function assertInteractiveResponseContext(
  runtime: AgentRuntime,
  operations: OperationRegistry,
  payload: Extract<AgentCommand, { type: "extension.ui.respond" | "approval.respond" }>["payload"]
): void {
  const identity = runtime.getIdentity();
  if (
    identity.sessionId !== payload.sessionId
    || identity.sessionGeneration !== payload.sessionGeneration
  ) {
    throw new HostCommandError(
      "STALE_SESSION_GENERATION",
      "The extension UI response belongs to a stale session generation.",
      true,
      {
        expectedSessionGeneration: identity.sessionGeneration,
        receivedSessionGeneration: payload.sessionGeneration
      }
    );
  }

  const activeOperation = operations.activeView();
  if (activeOperation?.operationId !== payload.operationId) {
    throw new HostCommandError(
      "STALE_OPERATION",
      "The extension UI response does not belong to the active operation.",
      true,
      { activeOperation: activeOperation !== undefined }
    );
  }
}
