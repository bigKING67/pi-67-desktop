import {
  eventEnvelope,
  isEventEnvelope,
  isResponseEnvelope,
  PROTOCOL_REVISION,
  responseEnvelope
} from "../../packages/protocol/dist/index.mjs";

export async function attachMockAgent(page, messageCount) {
  await page.exposeFunction("__pi67BuildPerformanceEvent", ({ type, payload, context }) => {
    const envelope = eventEnvelope(type, payload, context);
    if (!isEventEnvelope(envelope)) {
      throw new Error(`Performance fixture event failed protocol validation: type=${type}.`);
    }
    return envelope;
  });
  await page.exposeFunction("__pi67BuildPerformanceResponse", ({ requestId, hostEpoch, context, response }) => {
    const envelope = responseEnvelope(requestId, hostEpoch, context, response);
    if (!isResponseEnvelope(envelope)) {
      throw new Error(`Performance fixture response failed protocol validation: type=${response.type}.`);
    }
    return envelope;
  });
  await page.evaluate(({ count, protocolRevision }) => {
    let messages = Array.from({ length: count }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      parts: [{ type: "text", text: `Performance message ${index}: bounded transcript content.` }],
      createdAt: index
    }));
    let snapshot = {
      sessionId: "performance-session",
      sessionPath: "/tmp/pi67-performance-session.jsonl",
      cwd: "/tmp/pi67-performance-workspace",
      streaming: false,
      messages: messages.slice(-100),
      messagePage: {
        ...(messages.at(-100) ? { startCursor: messages.at(-100).id } : {}),
        ...(messages.at(-1) ? { endCursor: messages.at(-1).id } : {}),
        hasOlder: messages.length > 100,
        hasNewer: false
      },
      models: [{ provider: "fixture", id: "performance", label: "Performance fixture", configured: true, reasoning: true }],
      providers: [{ id: "fixture", label: "Performance fixture", configured: true, modelCount: 1 }],
      selectedModel: { provider: "fixture", id: "performance" },
      thinkingLevel: "medium",
      availableThinkingLevels: ["off", "medium", "high"],
      steeringQueue: [],
      followUpQueue: [],
      tree: { nodes: [], truncated: false, total: 0 },
      resources: [],
      stats: { tokens: 0, cost: 0, contextPercent: 0 }
    };
    let changes = {
      sessionId: snapshot.sessionId,
      items: [],
      truncated: false,
      total: 0
    };
    const sessionCatalogStatus = {
      revision: 1,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      reconciledAt: Date.now(),
      itemCount: 0,
      incomplete: false,
      skippedCount: 0
    };
    const runtimeCapabilities = {
      sdkVersion: "performance",
      supportsFollowUp: true,
      supportsSessionTree: true,
      extensionUi: {
        primitives: ["select", "confirm", "input", "editor", "notify", "status", "text-widget", "title"],
        attribution: "none",
        recognizedCompatibilityLevels: ["native", "headless", "adapter", "partial", "tui-only", "unsupported"],
        adapterRegistry: {
          available: false,
          manifestSchemaVersions: [],
          supportedSurfaces: [],
          realtimeUiAttribution: false,
          activeAdapterCount: 0
        },
        limitations: {
          workingIndicator: "unsupported",
          editorMutation: "unsupported",
          customComponents: "tui-only",
          autocomplete: "tui-only",
          widgetPlacements: ["aboveEditor", "belowEditor"]
        }
      }
    };
    const channel = new MessageChannel();
    const appInstanceId = "performance-app";
    const hostEpoch = 1;
    const operationId = "performance-operation";
    let messageSequence = 0;
    let activeTaskContext;
    const requests = [];
    const sendEvent = async (type, payload, eventOperationId) => {
      messageSequence += 1;
      const context = activeTaskContext ?? { scope: "app" };
      const eventContext = eventOperationId === undefined || context.scope !== "task"
        ? context
        : { ...context, operationId: eventOperationId };
      const envelope = await globalThis.__pi67BuildPerformanceEvent({
        type,
        payload,
        context: {
          hostEpoch,
          sequence: messageSequence,
          context: eventContext,
          ...(eventContext.scope === "task" ? { taskSequence: messageSequence } : {})
        }
      });
      channel.port2.postMessage(envelope);
    };
    const postResponse = async (request, response) => {
      const envelope = await globalThis.__pi67BuildPerformanceResponse({
        requestId: request.requestId,
        hostEpoch,
        context: request.context,
        response
      });
      channel.port2.postMessage(envelope);
    };
    channel.port2.onmessage = (event) => {
      const envelope = event.data;
      if (envelope?.kind === "hello") {
        channel.port2.postMessage({
          protocolVersion: 3,
          kind: "welcome",
          appInstanceId,
          hostInstanceId: "performance-host",
          hostEpoch,
          sdkVersion: "performance",
          protocolRevision,
          eventSequence: messageSequence,
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
      if (envelope?.kind !== "request" || !envelope.requestId) return;
      void handleRequest(envelope).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
    };
    channel.port2.start();

    async function handleRequest(envelope) {
      const type = envelope.type;
      requests.push(type);
      try {
        let result = type === "workspace.register"
          ? { registered: true }
          : type === "session.tree"
          ? snapshot.tree
          : type === "session.catalog.query"
            ? { ...sessionCatalogStatus, items: [], total: 0, hasMore: false }
          : type === "command.list"
            ? []
            : type === "workspace.changes"
              ? changes
            : type === "message.page"
              ? messagePage(envelope.payload ?? {})
              : type === "projection.resync"
                ? {
                    snapshot,
                    changes,
                    extensionCatalog: { items: [], total: 0, truncated: false },
                    sessionCatalogStatus,
                    eventSequence: messageSequence,
                    hostEpoch,
                    sessionGeneration: 1,
                    taskToolMode: "auto"
                  }
                : snapshot;
        if (type === "runtime.initialize" || type === "workspace.open") {
          activeTaskContext = envelope.context?.scope === "task"
            ? {
                ...envelope.context,
                sessionId: snapshot.sessionId,
                sessionGeneration: 1
              }
            : undefined;
          await sendEvent("runtime.ready", {
            capabilities: runtimeCapabilities,
            snapshot,
            taskToolMode: "auto"
          });
          result = projectionMutationAcknowledgement();
        }
        await postResponse(envelope, {
          ok: true,
          type,
          result
        });
      } catch (error) {
        await postResponse(envelope, {
          ok: false,
          type,
          error: {
            code: "PROTOCOL_MISMATCH",
            message: error instanceof Error ? error.message : "Performance fixture protocol validation failed.",
            recoverable: false
          }
        });
      }
    }

    globalThis.__pi67Performance = {
      async beginStreaming() {
        snapshot.streaming = true;
        await sendEvent("operation.started", {
          operation: {
            operationId,
            kind: "prompt",
            lifecycle: "running",
            cancellable: true,
            sessionId: snapshot.sessionId,
            sessionGeneration: 1,
            startedAt: Date.now()
          }
        }, operationId);
        await sendEvent("session.metaChanged", {
          streaming: true,
          thinkingLevel: snapshot.thinkingLevel,
          selectedModel: snapshot.selectedModel
        });
      },
      async emitStreamBatch(delta) {
        await sendEvent("turn.streamBatch", {
          events: [{ assistantMessageEvent: { type: "text_delta", delta } }]
        }, operationId);
      },
      async showMarkdown(markdown, messageId) {
        snapshot.streaming = false;
        messages = [{
          id: messageId,
          role: "assistant",
          parts: [{ type: "text", text: markdown }],
          createdAt: Date.now()
        }];
        await sendEvent("conversation.changed", { sessionId: snapshot.sessionId, reason: "settled" });
      },
      async switchSession(marker, nextMessageCount) {
        messages = Array.from({ length: nextMessageCount }, (_, index) => ({
          id: `${marker}-message-${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          parts: [{ type: "text", text: `${marker} message ${index}: bounded transcript content.` }],
          createdAt: index
        }));
        const visibleMessages = messages.slice(-100);
        snapshot = {
          ...snapshot,
          sessionId: `performance-${marker}`,
          sessionPath: `/tmp/performance-${marker}.jsonl`,
          streaming: false,
          messages: visibleMessages,
          messagePage: {
            ...(visibleMessages.at(0) ? { startCursor: visibleMessages.at(0).id } : {}),
            ...(visibleMessages.at(-1) ? { endCursor: visibleMessages.at(-1).id } : {}),
            hasOlder: messages.length > 100,
            hasNewer: false
          }
        };
        changes = { sessionId: snapshot.sessionId, items: [], truncated: false, total: 0 };
        if (activeTaskContext?.scope === "task") {
          activeTaskContext = {
            ...activeTaskContext,
            sessionId: snapshot.sessionId,
            sessionGeneration: 1
          };
        }
        await sendEvent("session.bootstrap", { snapshot, reason: "session-open" });
      },
      diagnostics() {
        return {
          sessionId: snapshot.sessionId,
          messageCount: messages.length,
          firstMessageId: messages.at(0)?.id,
          lastMessageId: messages.at(-1)?.id,
          messageSequence,
          requests: requests.slice(-20),
          streaming: snapshot.streaming
        };
      }
    };

    function messagePage(payload) {
      const cursorIndex = typeof payload.cursor === "string"
        ? messages.findIndex((message) => message.id === payload.cursor)
        : undefined;
      const limit = typeof payload.limit === "number" ? Math.min(200, Math.max(1, payload.limit)) : 100;
      const direction = payload.direction === "newer" ? "newer" : "older";
      const start = direction === "older"
        ? Math.max(0, (cursorIndex ?? messages.length) - limit)
        : cursorIndex === undefined ? 0 : cursorIndex + 1;
      const end = direction === "older"
        ? cursorIndex ?? messages.length
        : Math.min(messages.length, start + limit);
      const page = messages.slice(start, end);
      return {
        sessionId: snapshot.sessionId,
        messages: page,
        ...(page[0] ? { startCursor: page[0].id } : {}),
        ...(page.at(-1) ? { endCursor: page.at(-1).id } : {}),
        hasOlder: start > 0,
        hasNewer: end < messages.length
      };
    }

    function projectionMutationAcknowledgement() {
      return {
        accepted: true,
        hostEpoch,
        sessionId: snapshot.sessionId,
        sessionGeneration: 1,
        eventSequence: messageSequence
      };
    }
    window.postMessage(
      { source: "pi67-preload", type: "agent-port", appInstanceId, hostEpoch },
      window.location.origin,
      [channel.port1]
    );
  }, { count: messageCount, protocolRevision: PROTOCOL_REVISION });
}

export async function installPerformanceSystemBridge(page) {
  await page.addInitScript(() => {
    const workspace = {
      id: "workspace-performance",
      displayName: "pi67-performance-workspace",
      identity: {
        canonicalPath: "/tmp/pi67-performance-workspace",
        assurance: "path-only"
      },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    };
    let workbenchState = {
      version: 2,
      workspaces: [],
      workspaceOrder: [],
      expandedWorkspaceIds: [],
      runtimeRecovery: [],
      settings: { section: "general", scope: "global" },
      cleanExit: false
    };
    Object.defineProperty(window, "pi67", {
      configurable: false,
      value: {
        system: {
          getPlatformInfo: async () => ({ platform: "darwin", architecture: "arm64", version: "performance" }),
          connectAgentHost: async () => undefined,
          loadWorkbenchState: async () => structuredClone(workbenchState),
          updateWorkbenchLayout: async (layout) => {
            workbenchState = { ...workbenchState, ...structuredClone(layout) };
            return structuredClone(workbenchState);
          },
          pickAndAddWorkspace: async () => {
            workbenchState = {
              ...workbenchState,
              workspaces: [workspace],
              workspaceOrder: [workspace.id],
              expandedWorkspaceIds: [workspace.id],
              currentWorkspaceId: workspace.id
            };
            return structuredClone(workspace);
          },
          selectWorkspace: async () => "/tmp/pi67-performance-workspace",
          selectSessionFile: async () => undefined,
          saveDiagnostics: async () => undefined,
          showNotification: async () => undefined,
          requestOpenExternal: async () => false,
          getUpdateState: async () => ({
            phase: "disabled",
            channel: "unsigned-preview",
            currentVersion: "performance",
            detail: "Performance fixture"
          }),
          checkForUpdates: async () => ({
            phase: "disabled",
            channel: "unsigned-preview",
            currentVersion: "performance",
            detail: "Performance fixture"
          }),
          onAgentHostFailed: () => () => undefined,
          onPowerResume: () => () => undefined
        }
      }
    });
  });
}
