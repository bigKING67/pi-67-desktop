import type { Page } from "@playwright/test";
import type { MockAssetReadHandler } from "./pi67-renderer-asset-fixture.js";
import type { MockCommandResponseHandler } from "./pi67-renderer-command-fixture.js";
import type { MockPayloadSanitizer } from "./pi67-renderer-payload-sanitizer.js";
import type { MockOperationViewFactory, MockPlanImplementationLifecycleScheduler, MockProjectionAcknowledgementFactory } from "./pi67-renderer-operation-fixture.js";
import { createMockAgentFixtureInput } from "./pi67-renderer-agent-input-fixture.js";
import { installMockAgentHandlers } from "./pi67-renderer-agent-installation.js";
import type { FixtureAgentState, FixtureMessage, FixtureWindow,
  MockAgentOptions, TestPort } from "./pi67-renderer-fixture-types.js";
export type { FixtureMessage, MockAgentOptions } from "./pi67-renderer-fixture-types.js";
export { createMockProviderConfigurationSnapshot } from "./pi67-provider-configuration-snapshot-fixture.js";
export {
  clearRecordedCommands,
  currentMockSessionAuthority,
  emitMockAgentEvent,
  recordedCommandDetails,
  recordedCommands,
  replaceMockAgentHost,
  replaceMockSessionProjection,
  setMockAgentResponseDelay,
  setMockAgentResponseFailure,
  setMockAgentResponseResult,
  setMockConversationMessages,
  setMockResyncOperations,
  setMockWorkspaceChanges,
  waitForMockWorkspaceReady
} from "./pi67-renderer-controls.js";
export { installMockDesktopBridge } from "./pi67-renderer-desktop-bridge.js";
export async function attachMockAgent(
  page: Page,
  messages: FixtureMessage[] = [],
  responseDelays: Record<string, number> = {},
  options: MockAgentOptions = {}
): Promise<void> {
  await installMockAgentHandlers(page);
  await page.evaluate(({ fixtureMessages, fixtureResponseDelays, fixtureOptions, fixtureExtensionCatalog, fixtureRuntimeCapabilities, fixtureProviderConfiguration, fixtureContextFiles, fixtureSessionCatalogPage, fixtureSessionCatalogPagesByWorkspace, fixtureSnapshot, fixtureProtocolVersion, fixtureProtocolRevision }) => {
    const testWindow = window as FixtureWindow;
    const readMockAsset = (testWindow as FixtureWindow & { __pi67ReadMockAsset: MockAssetReadHandler }).__pi67ReadMockAsset;
    const resolveMockCommand = (testWindow as FixtureWindow & {
      __pi67ResolveMockCommand: MockCommandResponseHandler;
    }).__pi67ResolveMockCommand;
    const sanitizeMockPayload = (testWindow as FixtureWindow & {
      __pi67SanitizeMockPayload: MockPayloadSanitizer;
    }).__pi67SanitizeMockPayload;
    const operationView = (testWindow as FixtureWindow & { __pi67MockOperationView: MockOperationViewFactory }).__pi67MockOperationView;
    const projectionMutationAcknowledgement = (testWindow as FixtureWindow & { __pi67MockProjectionAcknowledgement: MockProjectionAcknowledgementFactory }).__pi67MockProjectionAcknowledgement;
    const schedulePlanImplementationLifecycle = (testWindow as FixtureWindow & { __pi67ScheduleMockPlanImplementationLifecycle: MockPlanImplementationLifecycleScheduler }).__pi67ScheduleMockPlanImplementationLifecycle;
    const sessionBootstrapCommands = new Set(["session.create", "session.open", "session.fork", "session.forkFromTask"]);
    const sessionForkCommands = new Set(["session.fork", "session.forkFromTask"]);
    const sessionBootstrapReasons: Record<string, string> = { "session.create": "session-create", "session.open": "session-open", "session.fork": "session-fork", "session.forkFromTask": "session-fork" };
    const state: FixtureAgentState = {
      appInstanceId: "app-test",
      ready: false,
      hostEpoch: fixtureOptions.hostEpoch ?? 1,
      sequence: 0,
      taskSequence: 0,
      workspaceId: "workspace-test",
      taskId: "task-test",
      taskGeneration: 1,
      sessionGeneration: 1,
      taskToolMode: "auto",
      sessionCounter: 0,
      operationCounter: 0,
      conversationMessages: fixtureMessages,
      workspaceChanges: { sessionId: "session-test", items: [], truncated: false, total: 0 },
      extensionCatalog: fixtureOptions.extensionCatalog ?? fixtureExtensionCatalog,
      contextFiles: fixtureOptions.contextFiles ?? fixtureContextFiles,
      providerConfiguration: fixtureProviderConfiguration,
      sessionCatalogPage: fixtureSessionCatalogPage,
      sessionCatalogPagesByWorkspace: fixtureSessionCatalogPagesByWorkspace,
      assets: fixtureOptions.assets ?? {},
      snapshot: fixtureSnapshot,
      responseDelays: fixtureResponseDelays,
      responseFailures: {},
      responseResults: fixtureOptions.responseResults ?? {},
      commands: [],
      taskStates: {},
      resyncOperations: {},
      ...(fixtureOptions.terminalDelayMs === undefined ? {} : { terminalDelayMs: fixtureOptions.terminalDelayMs }),
      autoStartOperation: fixtureOptions.autoStartOperation !== false,
      attachHost(hostEpoch) {
        state.ready = false;
        state.hostEpoch = hostEpoch;
        state.sequence = 0;
        state.taskSequence = 0;
        for (const taskState of Object.values(state.taskStates)) taskState.taskSequence = 0;
        state.resyncOperations = {};
        const channel = new MessageChannel();
        const hostPort = channel.port2 as TestPort;
        state.activePort = hostPort;
        hostPort.onmessage = async (messageEvent) => {
          const envelope = messageEvent.data as {
            kind?: string;
            appInstanceId?: string;
            requestId?: string;
            hostEpoch?: number;
            context?: Record<string, unknown>;
            type?: string;
            payload?: Record<string, unknown>;
          };
          if (envelope.kind === "hello") {
            state.ready = true;
            hostPort.postMessage({
              protocolVersion: fixtureProtocolVersion,
              protocolRevision: fixtureProtocolRevision,
              kind: "welcome",
              appInstanceId: state.appInstanceId,
              hostInstanceId: `host-${hostEpoch}`,
              hostEpoch,
              sdkVersion: "0.81.1",
              eventSequence: state.sequence,
              capabilities: {
                operations: true,
                eventSequence: true,
                structuredErrors: true,
                transferableImages: true,
                transferableAssets: true,
                idempotentControlMutations: true
              },
              maxEnvelopeBytes: 2 * 1024 * 1024
            });
            return;
          }
          if (envelope.kind !== "request" || !envelope.requestId || !envelope.type
            || envelope.hostEpoch !== hostEpoch || !envelope.context) return;
          if (envelope.context.scope === "task") {
            activateTaskContext(envelope.context);
          } else if (
            envelope.context.scope === "workspace"
            && typeof envelope.context.workspaceId === "string"
          ) {
            state.workspaceId = envelope.context.workspaceId;
          }
          state.commands.push({
            type: envelope.type,
            payload: await sanitizeMockPayload(envelope.type, envelope.payload),
            hostEpoch,
            context: structuredClone(envelope.context)
          });
          const failure = state.responseFailures[envelope.type];
          const preparedPage = envelope.type === "message.page" && !failure
            ? resolveMockCommand(envelope.type, envelope.payload ?? {}, state, hostEpoch)
            : undefined;
          const respond = () => {
            if (envelope.context?.scope === "task") activateTaskContext(envelope.context);
            if (failure) {
              hostPort.postMessage({
                protocolVersion: fixtureProtocolVersion,
                kind: "response",
                requestId: envelope.requestId,
                hostEpoch,
                context: envelope.context,
                type: envelope.type,
                ok: false,
                error: failure
              });
              return;
            }
            if (envelope.type === "asset.read") {
              const assetResponse = readMockAsset(envelope.payload ?? {}, state);
              if (!assetResponse.ok) {
                hostPort.postMessage({
                  protocolVersion: fixtureProtocolVersion,
                  kind: "response",
                  requestId: envelope.requestId,
                  hostEpoch,
                  context: envelope.context,
                  type: envelope.type,
                  ok: false,
                  error: assetResponse.error
                });
                return;
              }
              hostPort.postMessage({
                protocolVersion: fixtureProtocolVersion,
                kind: "response",
                requestId: envelope.requestId,
                hostEpoch,
                context: envelope.context,
                type: envelope.type,
                ok: true,
                result: assetResponse.result
              }, [assetResponse.result.data]);
              return;
            }
            const hasConfiguredResult = Object.prototype.hasOwnProperty.call(
              state.responseResults,
              envelope.type!
            );
            let result = hasConfiguredResult
              ? state.responseResults[envelope.type!]
              : preparedPage ?? resolveMockCommand(envelope.type!, envelope.payload ?? {}, state, hostEpoch);
            if (envelope.type === "runtime.initialize" || envelope.type === "workspace.open") {
              if (
                envelope.type === "runtime.initialize"
                && typeof envelope.payload?.sessionPath === "string"
                && !hasConfiguredResult
              ) testWindow.__pi67RotateMockSession(
                state,
                envelope.payload.sessionPath,
                undefined,
                catalogSessionFileIdentity(envelope.payload.sessionPath)
              );
              emitThrough(hostPort, hostEpoch, {
                type: "extension.catalog.changed",
                payload: state.extensionCatalog
              });
              emitThrough(hostPort, hostEpoch, {
                type: "runtime.ready",
                payload: {
                  capabilities: fixtureRuntimeCapabilities,
                  snapshot: state.snapshot,
                  taskToolMode: state.taskToolMode
                }
              });
              if (!hasConfiguredResult) {
                result = projectionMutationAcknowledgement(state, hostEpoch);
              }
            }
            if (sessionBootstrapCommands.has(envelope.type!)) {
              if (
                envelope.type === "session.create"
                && fixtureOptions.rotateSessionOnCreate === true
                && !hasConfiguredResult
              ) testWindow.__pi67RotateMockSession(state);
              if (
                envelope.type === "session.open"
                && typeof envelope.payload?.path === "string"
                && !hasConfiguredResult
              ) testWindow.__pi67RotateMockSession(
                state,
                envelope.payload.path,
                fixtureOptions.sessionMessagesByPath?.[envelope.payload.path],
                catalogSessionFileIdentity(envelope.payload.path)
              );
              if (sessionForkCommands.has(envelope.type!) && !hasConfiguredResult) {
                testWindow.__pi67ForkMockSession(
                  state,
                  envelope.payload?.entryId,
                  envelope.type === "session.fork" ? envelope.payload?.position : "at"
                );
              }
              emitThrough(hostPort, hostEpoch, {
                type: "extension.catalog.changed",
                payload: state.extensionCatalog
              });
              emitThrough(hostPort, hostEpoch, {
                type: "session.bootstrap",
                payload: {
                  snapshot: state.snapshot,
                  reason: sessionBootstrapReasons[envelope.type!]
                }
              });
              if (!hasConfiguredResult) {
                result = projectionMutationAcknowledgement(state, hostEpoch);
              }
            }
            if (envelope.type === "session.name" && !hasConfiguredResult) {
              result = projectionMutationAcknowledgement(state, hostEpoch);
            }
            if (envelope.type === "session.interactionMode.set") {
              emitThrough(hostPort, hostEpoch, {
                type: "session.interactionModeChanged",
                payload: { interactionMode: state.snapshot.interactionMode }
              });
              result = projectionMutationAcknowledgement(state, hostEpoch);
            }
            hostPort.postMessage({
              protocolVersion: fixtureProtocolVersion,
              kind: "response",
              requestId: envelope.requestId,
              hostEpoch,
              context: envelope.context,
              type: envelope.type,
              ok: true,
              result
            });
            if (envelope.type === "task.toolMode.set") {
              emitThrough(hostPort, hostEpoch, {
                type: "task.toolMode.changed",
                payload: { mode: state.taskToolMode, reason: "user-selected" }
              });
            }
            if (
              envelope.type === "approval.respond"
              && envelope.payload?.decision === "enable-task-yolo-and-allow"
            ) {
              emitThrough(hostPort, hostEpoch, {
                type: "task.toolMode.changed",
                payload: { mode: state.taskToolMode, reason: "approval-enabled-yolo" }
              }, typeof envelope.payload.operationId === "string" ? envelope.payload.operationId : undefined);
            }
            if (envelope.type === "prompt.submit" || envelope.type === "plan.implement") {
              const accepted = result as { operationId: string };
              state.snapshot = { ...state.snapshot, streaming: true };
              if (state.autoStartOperation) setTimeout(() => emitThrough(hostPort, hostEpoch, {
                type: "operation.started",
                payload: {
                  operation: operationView(accepted.operationId, "prompt", "running", state)
                }
              }, accepted.operationId), 0);
              if (envelope.type === "plan.implement") setTimeout(() => {
                schedulePlanImplementationLifecycle(
                  state,
                  hostEpoch,
                  envelope.payload,
                  accepted.operationId,
                  fixtureOptions.planImplementationStartDelayMs ?? 0,
                  (event, operationId) => emitThrough(hostPort, hostEpoch, event, operationId)
                );
              }, 0);
              if (state.terminalDelayMs !== undefined) setTimeout(() => {
                state.snapshot = { ...state.snapshot, streaming: false };
                emitThrough(hostPort, hostEpoch, {
                  type: "operation.completed",
                  payload: { operationId: accepted.operationId, completedAt: Date.now() }
                }, accepted.operationId);
              }, state.terminalDelayMs);
            }
            if (envelope.type === "session.import") {
              const accepted = result as { operationId: string };
              setTimeout(() => {
                emitThrough(hostPort, hostEpoch, {
                  type: "operation.started",
                  payload: {
                    operation: operationView(accepted.operationId, "session-import", "running", state)
                  }
                }, accepted.operationId);
                state.sessionGeneration += 1;
                state.snapshot = {
                  ...state.snapshot,
                  sessionId: "session-imported",
                  sessionFileIdentity: "session-file-fixture-imported",
                  sessionPath: "/Users/test/.pi/agent/sessions/imported.jsonl"
                };
                state.workspaceChanges = { ...state.workspaceChanges, sessionId: "session-imported", items: [], total: 0 };
                emitThrough(hostPort, hostEpoch, {
                  type: "session.bootstrap",
                  payload: { snapshot: state.snapshot, reason: "session-import" }
                }, accepted.operationId);
                emitThrough(hostPort, hostEpoch, {
                  type: "operation.completed",
                  payload: { operationId: accepted.operationId, completedAt: Date.now() }
                }, accepted.operationId);
              }, 0);
            }
            saveActiveTaskState();
          };
          const delay = state.responseDelays[envelope.type] ?? 0;
          if (delay > 0) setTimeout(respond, delay);
          else respond();
        };
        hostPort.start();
        window.postMessage({
          source: "pi67-preload",
          type: "agent-port",
          appInstanceId: state.appInstanceId,
          hostEpoch
        }, window.location.origin, [channel.port1]);
      },
      emit(event, emitOptions = {}) {
        const targetEpoch = emitOptions.hostEpoch ?? state.hostEpoch;
        const sequence = emitOptions.sequence
          ?? (targetEpoch === state.hostEpoch ? ++state.sequence : 1);
        if (targetEpoch === state.hostEpoch && sequence > state.sequence) state.sequence = sequence;
        const taskSequence = emitOptions.taskSequence
          ?? (targetEpoch === state.hostEpoch ? ++state.taskSequence : 1);
        if (targetEpoch === state.hostEpoch && taskSequence > state.taskSequence) state.taskSequence = taskSequence;
        const sessionId = emitOptions.sessionId ?? String(state.snapshot.sessionId);
        const sessionFileIdentity = emitOptions.sessionFileIdentity
          ?? String(state.snapshot.sessionFileIdentity);
        const sessionGeneration = emitOptions.sessionGeneration ?? state.sessionGeneration;
        const eventContext = emitOptions.context
          ?? (event.type === "provider.configuration.changed" ? "app" : "task");
        state.activePort?.postMessage({
          protocolVersion: fixtureProtocolVersion,
          kind: "event",
          hostEpoch: targetEpoch,
          sequence,
          context: eventContext === "app"
            ? { scope: "app" }
            : eventContext === "workspace"
              ? { scope: "workspace", workspaceId: state.workspaceId }
              : {
                scope: "task",
                workspaceId: state.workspaceId,
                taskId: state.taskId,
                taskGeneration: state.taskGeneration,
                sessionId,
                sessionFileIdentity,
                sessionGeneration,
                ...(emitOptions.operationId === undefined ? {} : { operationId: emitOptions.operationId })
              },
          ...(eventContext === "task" ? { taskSequence } : {}),
          type: event.type,
          payload: event.payload
        });
        saveActiveTaskState();
      }
    };
    function activateTaskContext(context: Record<string, unknown>): void {
      if (typeof context.workspaceId !== "string" || typeof context.taskId !== "string") return;
      if (fixtureOptions.isolateTaskSnapshots === true) {
        saveActiveTaskState();
      }
      state.workspaceId = context.workspaceId;
      state.taskId = context.taskId;
      if (typeof context.taskGeneration === "number") state.taskGeneration = context.taskGeneration;
      if (fixtureOptions.isolateTaskSnapshots !== true) return;
      const saved = state.taskStates[activeTaskKey()];
      if (saved) {
        state.taskSequence = saved.taskSequence;
        state.sessionGeneration = saved.sessionGeneration;
        state.taskToolMode = saved.taskToolMode;
        state.conversationMessages = saved.conversationMessages;
        state.workspaceChanges = saved.workspaceChanges;
        state.snapshot = saved.snapshot;
        return;
      }
      state.taskSequence = 0;
      state.taskToolMode = "auto";
      state.conversationMessages = structuredClone(state.conversationMessages);
      state.workspaceChanges = structuredClone(state.workspaceChanges);
      state.snapshot = structuredClone(state.snapshot);
      saveActiveTaskState();
    }
    function saveActiveTaskState(): void {
      if (fixtureOptions.isolateTaskSnapshots !== true) return;
      state.taskStates[activeTaskKey()] = {
        taskSequence: state.taskSequence,
        sessionGeneration: state.sessionGeneration,
        taskToolMode: state.taskToolMode,
        conversationMessages: state.conversationMessages,
        workspaceChanges: state.workspaceChanges,
        snapshot: state.snapshot
      };
    }
    function activeTaskKey(): string {
      return `${state.workspaceId}\u0000${state.taskId}`;
    }
    function catalogSessionFileIdentity(path: string): string | undefined {
      const sessions = [...(fixtureOptions.sessionCatalogItems ?? []),
        ...Object.values(fixtureOptions.sessionCatalogItemsByWorkspace ?? {}).flat()];
      return sessions.find((session) => session.path === path)?.fileIdentity;
    }
    function emitThrough(port: TestPort, hostEpoch: number, event: { type: string; payload: unknown }, operationId?: string): void {
      if (hostEpoch !== state.hostEpoch || port !== state.activePort) return;
      state.emit(event, { hostEpoch, ...(operationId === undefined ? {} : { operationId }) });
    }
    testWindow.__pi67TestAgent = state;
    state.attachHost(state.hostEpoch);
  }, createMockAgentFixtureInput(messages, responseDelays, options));
  await page.waitForFunction(() => (
    window as unknown as FixtureWindow
  ).__pi67TestAgent?.ready === true);
}
