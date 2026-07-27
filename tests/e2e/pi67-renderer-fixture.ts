import type { Page } from "@playwright/test";
import {
  MOCK_EXTENSION_CATALOG,
  MOCK_EXTENSION_COMMANDS,
  MOCK_RUNTIME_CAPABILITIES
} from "./pi67-extension-catalog-fixture.js";
import { MOCK_SESSION_CATALOG_STATUS, mockSessionCatalogPage } from "./pi67-session-catalog-fixture.js";
import {
  createMockSessionSnapshot,
  installMockSessionControlCommandHandler,
  type MockSessionControlCommandHandler
} from "./pi67-renderer-snapshot-fixture.js";
import {
  installMockAssetReadHandler,
  type MockAssetReadHandler
} from "./pi67-renderer-asset-fixture.js";
import type {
  FixtureAgentState,
  FixtureMessage,
  FixtureWindow,
  MockAgentOptions,
  TestPort
} from "./pi67-renderer-fixture-types.js";
export type { FixtureMessage, MockAgentOptions } from "./pi67-renderer-fixture-types.js";
export {
  clearRecordedCommands,
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
  setMockWorkspaceChanges
} from "./pi67-renderer-controls.js";
export { installMockDesktopBridge } from "./pi67-renderer-desktop-bridge.js";
export async function attachMockAgent(
  page: Page,
  messages: FixtureMessage[] = [],
  responseDelays: Record<string, number> = {},
  options: MockAgentOptions = {}
): Promise<void> {
  await page.evaluate(installMockSessionControlCommandHandler);
  await page.evaluate(installMockAssetReadHandler);
  await page.evaluate(({ fixtureMessages, fixtureResponseDelays, fixtureOptions, fixtureExtensionCatalog, fixtureExtensionCommands, fixtureRuntimeCapabilities, fixtureSessionCatalogStatus, fixtureSessionCatalogPage, fixtureSnapshot }) => {
    const testWindow = window as FixtureWindow;
    const applyMockSessionControlCommand = (testWindow as FixtureWindow & {
      __pi67ApplyMockSessionControlCommand: MockSessionControlCommandHandler;
    }).__pi67ApplyMockSessionControlCommand;
    const readMockAsset = (testWindow as FixtureWindow & {
      __pi67ReadMockAsset: MockAssetReadHandler;
    }).__pi67ReadMockAsset;

    const state: FixtureAgentState = {
      appInstanceId: "app-test",
      hostEpoch: fixtureOptions.hostEpoch ?? 1,
      sequence: 0,
      sessionGeneration: 1,
      operationCounter: 0,
      conversationMessages: fixtureMessages,
      workspaceChanges: { sessionId: "session-test", items: [], truncated: false, total: 0 },
      extensionCatalog: fixtureExtensionCatalog,
      sessionCatalogPage: fixtureSessionCatalogPage,
      assets: fixtureOptions.assets ?? {},
      snapshot: fixtureSnapshot,
      responseDelays: fixtureResponseDelays,
      responseFailures: {},
      responseResults: {},
      commands: [],
      resyncOperations: {},
      ...(fixtureOptions.terminalDelayMs === undefined ? {} : { terminalDelayMs: fixtureOptions.terminalDelayMs }),
      autoStartOperation: fixtureOptions.autoStartOperation !== false,

      attachHost(hostEpoch) {
        state.hostEpoch = hostEpoch;
        state.sequence = 0;
        state.resyncOperations = {};
        const channel = new MessageChannel();
        const hostPort = channel.port2 as TestPort;
        state.activePort = hostPort;
        hostPort.onmessage = (messageEvent) => {
          const envelope = messageEvent.data as {
            kind?: string;
            appInstanceId?: string;
            requestId?: string;
            hostEpoch?: number;
            type?: string;
            payload?: Record<string, unknown>;
          };
          if (envelope.kind === "hello") {
            hostPort.postMessage({
              protocolVersion: 2,
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
          if (envelope.kind !== "request" || !envelope.requestId || !envelope.type || envelope.hostEpoch !== hostEpoch) return;
          state.commands.push({ type: envelope.type, payload: sanitizedPayload(envelope.type, envelope.payload), hostEpoch });
          const failure = state.responseFailures[envelope.type];
          const preparedPage = envelope.type === "message.page" && !failure
            ? resultFor(envelope.type, envelope.payload ?? {}, state, hostEpoch)
            : undefined;
          const respond = () => {
            if (failure) {
              hostPort.postMessage({
                protocolVersion: 2,
                kind: "response",
                requestId: envelope.requestId,
                hostEpoch,
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
                  protocolVersion: 2,
                  kind: "response",
                  requestId: envelope.requestId,
                  hostEpoch,
                  type: envelope.type,
                  ok: false,
                  error: assetResponse.error
                });
                return;
              }
              hostPort.postMessage({
                protocolVersion: 2,
                kind: "response",
                requestId: envelope.requestId,
                hostEpoch,
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
              : preparedPage ?? resultFor(envelope.type!, envelope.payload ?? {}, state, hostEpoch);
            if (envelope.type === "runtime.initialize" || envelope.type === "workspace.open") {
              emitThrough(hostPort, hostEpoch, {
                type: "extension.catalog.changed",
                payload: state.extensionCatalog
              });
              emitThrough(hostPort, hostEpoch, {
                type: "runtime.ready",
                payload: {
                  capabilities: fixtureRuntimeCapabilities,
                  snapshot: state.snapshot
                }
              });
              if (!hasConfiguredResult) {
                result = projectionMutationAcknowledgement(state, hostEpoch);
              }
            }
            if (
              envelope.type === "session.create"
              || envelope.type === "session.open"
              || envelope.type === "session.fork"
            ) {
              emitThrough(hostPort, hostEpoch, {
                type: "extension.catalog.changed",
                payload: state.extensionCatalog
              });
              emitThrough(hostPort, hostEpoch, {
                type: "session.bootstrap",
                payload: {
                  snapshot: state.snapshot,
                  reason: envelope.type === "session.create"
                    ? "session-create"
                    : envelope.type === "session.open"
                      ? "session-open"
                      : "session-fork"
                }
              });
              if (!hasConfiguredResult) {
                result = projectionMutationAcknowledgement(state, hostEpoch);
              }
            }
            hostPort.postMessage({
              protocolVersion: 2,
              kind: "response",
              requestId: envelope.requestId,
              hostEpoch,
              type: envelope.type,
              ok: true,
              result
            });
            if (envelope.type === "prompt.submit") {
              const accepted = result as { operationId: string };
              state.snapshot = { ...state.snapshot, streaming: true };
              if (state.autoStartOperation) setTimeout(() => emitThrough(hostPort, hostEpoch, {
                type: "operation.started",
                payload: {
                  operation: operationView(accepted.operationId, "prompt", "running", state)
                }
              }, accepted.operationId), 0);
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
                  sessionPath: "/Users/test/.pi/agent/sessions/imported.jsonl"
                };
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
        state.activePort?.postMessage({
          protocolVersion: 2,
          kind: "event",
          hostEpoch: targetEpoch,
          sequence,
          type: event.type,
          payload: event.payload,
          sessionId: emitOptions.sessionId ?? String(state.snapshot.sessionId),
          sessionGeneration: emitOptions.sessionGeneration ?? state.sessionGeneration,
          ...(emitOptions.operationId === undefined ? {} : { operationId: emitOptions.operationId })
        });
      }
    };

    function emitThrough(port: TestPort, hostEpoch: number, event: { type: string; payload: unknown }, operationId?: string): void {
      if (hostEpoch !== state.hostEpoch || port !== state.activePort) return;
      state.emit(event, { hostEpoch, ...(operationId === undefined ? {} : { operationId }) });
    }

    function operationView(operationId: string, kind: string, lifecycle: string, current: FixtureAgentState): Record<string, unknown> {
      return {
        operationId,
        kind,
        lifecycle,
        cancellable: kind === "prompt" || kind === "compaction",
        sessionId: String(current.snapshot.sessionId),
        sessionGeneration: current.sessionGeneration,
        startedAt: Date.now()
      };
    }

    function acceptedOperation(current: FixtureAgentState, hostEpoch: number, cancellable: boolean): Record<string, unknown> {
      const operationId = `operation-${++current.operationCounter}`;
      return {
        kind: "accepted",
        operationId,
        cancellable,
        hostEpoch,
        sessionId: String(current.snapshot.sessionId),
        sessionGeneration: current.sessionGeneration
      };
    }

    function projectionMutationAcknowledgement(
      current: FixtureAgentState,
      hostEpoch: number
    ): Record<string, unknown> {
      return {
        accepted: true,
        hostEpoch,
        sessionId: String(current.snapshot.sessionId),
        sessionGeneration: current.sessionGeneration,
        eventSequence: current.sequence
      };
    }

    function resultFor(type: string, payload: Record<string, unknown>, current: FixtureAgentState, hostEpoch: number): unknown {
      if (type === "runtime.getStatus") return { initialized: true, loaded: true };
      if (type === "projection.resync") return {
        snapshot: current.snapshot,
        changes: current.workspaceChanges,
        extensionCatalog: current.extensionCatalog,
        sessionCatalogStatus: {
          ...fixtureSessionCatalogStatus,
          itemCount: current.sessionCatalogPage.itemCount
        },
        eventSequence: current.sequence,
        hostEpoch,
        sessionGeneration: current.sessionGeneration,
        ...current.resyncOperations
      };
      if (type === "workspace.changes") return current.workspaceChanges;
      if (type === "extension.catalog.list") return current.extensionCatalog;
      if (type === "session.catalog.query") return current.sessionCatalogPage;
      if (type === "message.page") return conversationPage(current, payload);
      if (type === "session.tree") return current.snapshot.tree;
      if (type === "command.list") return fixtureExtensionCommands;
      if (
        type === "model.list"
        || type === "resource.list"
      ) return [];
      if (type === "prompt.submit" || type === "session.compact" || type === "command.invoke" || type === "session.import") {
        return acceptedOperation(current, hostEpoch, type === "prompt.submit" || type === "session.compact");
      }
      if (type === "prompt.steer" || type === "prompt.followUp") return { accepted: true };
      if (type === "queue.clear") {
        const steeringCount = (current.snapshot.steeringQueue as unknown[]).length;
        const followUpCount = (current.snapshot.followUpQueue as unknown[]).length;
        current.snapshot = { ...current.snapshot, steeringQueue: [], followUpQueue: [] };
        return { steeringCount, followUpCount, pendingCount: 0 };
      }
      if (type === "operation.abort") return { aborted: true, ...(typeof payload.operationId === "string" ? { operationId: payload.operationId } : {}) };
      if (type === "extension.ui.respond" || type === "approval.respond") return { resolved: true };
      if (type === "doctor.run") return {
        generatedAt: Date.now(),
        checks: [
          { id: "platform", label: "Platform", status: "pass", detail: "darwin/arm64" },
          { id: "node", label: "Embedded Node", status: "pass", detail: "24.18.0" },
          { id: "pi-sdk", label: "Pi SDK", status: "pass", detail: "0.81.1" },
          { id: "shell", label: "Pi shell", status: "pass", detail: "/bin/bash - GNU bash" },
          { id: "git", label: "Git", status: "pass", detail: "git version 2.50.0" }
        ]
      };
      if (type === "diagnostics.collect") return {
        application: "Pi-67 Desktop",
        piSdkVersion: "0.81.1",
        platform: "darwin",
        architecture: "arm64",
        node: "24.18.0",
        cwd: current.snapshot.cwd,
        sessionConfigured: true,
        sessionFileConfigured: true,
        model: "openai/gpt-test",
        extensionCount: 0,
        extensionErrors: []
      };
      const controlCommand = applyMockSessionControlCommand(type, payload, current.snapshot);
      if (controlCommand) {
        current.snapshot = controlCommand.snapshot;
        return controlCommand.result;
      }
      return current.snapshot;
    }

    function conversationPage(current: FixtureAgentState, payload: Record<string, unknown>): Record<string, unknown> {
      const direction = payload.direction === "newer" ? "newer" : "older";
      const limit = typeof payload.limit === "number" ? Math.min(200, Math.max(1, payload.limit)) : 100;
      const cursor = typeof payload.cursor === "string" ? payload.cursor : undefined;
      const cursorIndex = cursor === undefined
        ? undefined
        : current.conversationMessages.findIndex((message) => message.id === cursor);
      const start = direction === "older"
        ? Math.max(0, (cursorIndex ?? current.conversationMessages.length) - limit)
        : cursorIndex === undefined ? 0 : cursorIndex + 1;
      const end = direction === "older"
        ? cursorIndex ?? current.conversationMessages.length
        : Math.min(current.conversationMessages.length, start + limit);
      const messages = current.conversationMessages.slice(start, end);
      return {
        sessionId: String(current.snapshot.sessionId),
        messages,
        ...pageMetadata(messages, start > 0, end < current.conversationMessages.length)
      };
    }

    function pageMetadata(messages: FixtureMessage[], hasOlder: boolean, hasNewer: boolean): Record<string, unknown> {
      return {
        ...(messages[0] === undefined ? {} : { startCursor: messages[0].id }),
        ...(messages.at(-1) === undefined ? {} : { endCursor: messages.at(-1)!.id }),
        hasOlder,
        hasNewer
      };
    }

    function sanitizedPayload(type: string, payload: Record<string, unknown> | undefined): unknown {
      if (type !== "prompt.submit" || !payload) return payload ?? {};
      const images = Array.isArray(payload.images) ? payload.images : [];
      return {
        ...payload,
        images: images.map((image) => {
          const value = image as { name?: unknown; mimeType?: unknown; data?: ArrayBuffer };
          return { name: value.name, mimeType: value.mimeType, bytes: value.data?.byteLength ?? 0 };
        })
      };
    }

    testWindow.__pi67TestAgent = state;
    state.attachHost(state.hostEpoch);
  }, {
    fixtureMessages: messages,
    fixtureResponseDelays: responseDelays,
    fixtureOptions: options,
    fixtureExtensionCatalog: MOCK_EXTENSION_CATALOG,
    fixtureExtensionCommands: MOCK_EXTENSION_COMMANDS,
    fixtureRuntimeCapabilities: MOCK_RUNTIME_CAPABILITIES,
    fixtureSessionCatalogStatus: MOCK_SESSION_CATALOG_STATUS,
    fixtureSessionCatalogPage: mockSessionCatalogPage(options.sessionCatalogItems ?? []),
    fixtureSnapshot: createMockSessionSnapshot(messages)
  });
}
