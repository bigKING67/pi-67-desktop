import { createHash } from "node:crypto";
import type { AgentRuntime } from "@pi67/pi-runtime";
import type {
  AgentCommand,
  AgentEvent,
  CommandResults,
  ProjectionMutationAcknowledgement
} from "@pi67/protocol";
import type { OperationRegistry } from "./operation-registry.js";
import { HostCommandError } from "./protocol-error.js";

export type RuntimeLoadedCommand = Exclude<
  AgentCommand,
  {
    type:
      | "runtime.getStatus"
      | "queue.clear"
      | "task.close"
      | "workspace.register"
      | "workspace.unregister"
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
      | "extension.package.list"
      | "extension.package.checkUpdates"
      | "extension.package.install"
      | "extension.package.update"
      | "extension.package.setEnabled"
      | "extension.package.restoreInheritance"
      | "extension.package.uninstall";
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
  commitSessionWriter: (runtime: AgentRuntime) => Promise<void>;
  operations: () => OperationRegistry;
  completeInteractiveWait: (requestId: string) => void;
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
      runtime.setWorkspacePolicy(command.payload.trust, command.payload.approvalMode);
      return runtime.reloadResources();
    case "workspace.changes":
      return runtime.getWorkspaceChanges();
    case "session.catalog.query":
      return runtime.querySessionCatalog(command.payload);
    case "session.tree":
      return runtime.getSessionTree();
    case "message.page":
      return runtime.getMessagePage(command.payload);
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
      const snapshot = await runtime.createSession();
      await context.commitSessionWriter(runtime);
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
                context.operations().poisonSessionImportProjection();
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
      const snapshot = await runtime.forkSession(command.payload.entryId);
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
      await runtime.setSessionName(command.payload.name);
      return context.captureProjectionMutationAcknowledgement(runtime);
    case "prompt.submit": {
      const operations = context.operations();
      const fingerprint = submissionFingerprint ?? promptSubmissionFingerprint(command.payload);
      if (command.payload.delivery === "steer") {
        return operations.queueForActive(
          command.payload.submissionId,
          fingerprint,
          () => runtime.steer(command.payload.text, command.payload.images)
        );
      }
      if (command.payload.delivery === "follow-up") {
        return operations.queueForActive(
          command.payload.submissionId,
          fingerprint,
          () => runtime.followUp(command.payload.text, command.payload.images)
        );
      }
      return operations.accept({
        submissionId: command.payload.submissionId,
        fingerprint,
        kind: "prompt",
        execute: () => runtime.submitPrompt(command.payload.text, command.payload.images),
        abort: () => runtime.abort(),
        beforeTerminal: () => runtime.flushStream()
      });
    }
    case "prompt.steer":
      await runtime.steer(command.payload.text, command.payload.images);
      return { accepted: true };
    case "prompt.followUp":
      await runtime.followUp(command.payload.text, command.payload.images);
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
      return interactiveResponse(
        command.payload.requestId,
        runtime.resolveApproval(
          command.payload.requestId,
          command.payload.toolCallId,
          command.payload.allowed
        ),
        context.completeInteractiveWait
      );
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

function promptSubmissionFingerprint(
  payload: Extract<AgentCommand, { type: "prompt.submit" }>["payload"]
): string {
  const hash = createHash("sha256");
  const updateText = (value: string) => hash.update(value, "utf8").update("\0");
  updateText(payload.delivery);
  updateText(payload.text);
  for (const image of payload.images ?? []) {
    updateText(image.name);
    updateText(image.mimeType);
    hash.update(Buffer.from(image.data));
  }
  return hash.digest("hex");
}

export interface OperationSubmissionIdentity {
  submissionId: string;
  fingerprint: string;
}

export function operationSubmissionIdentity(command: AgentCommand): OperationSubmissionIdentity | undefined {
  switch (command.type) {
    case "prompt.submit":
      return {
        submissionId: command.payload.submissionId,
        fingerprint: promptSubmissionFingerprint(command.payload)
      };
    case "session.import":
      return textOperationSubmissionIdentity(
        command.payload.submissionId,
        command.type,
        command.payload.path
      );
    case "session.compact":
      return textOperationSubmissionIdentity(
        command.payload.submissionId,
        command.type,
        command.payload.instructions ?? ""
      );
    case "command.invoke":
      return textOperationSubmissionIdentity(
        command.payload.submissionId,
        command.type,
        command.payload.command
      );
    default:
      return undefined;
  }
}

function textOperationSubmissionIdentity(
  submissionId: string,
  type: "session.import" | "session.compact" | "command.invoke",
  value: string
): OperationSubmissionIdentity {
  const hash = createHash("sha256");
  hash.update(type, "utf8").update("\0").update(value, "utf8");
  return { submissionId, fingerprint: hash.digest("hex") };
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
