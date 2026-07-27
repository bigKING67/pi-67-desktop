export async function attachMockAgent(page, messageCount) {
  await page.evaluate((count) => {
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
    const requests = [];
    const sendEvent = (type, payload, eventOperationId) => {
      messageSequence += 1;
      channel.port2.postMessage({
        protocolVersion: 2,
        kind: "event",
        hostEpoch,
        sequence: messageSequence,
        type,
        payload,
        sessionId: snapshot.sessionId,
        sessionGeneration: 1,
        ...(eventOperationId === undefined ? {} : { operationId: eventOperationId })
      });
    };
    channel.port2.onmessage = (event) => {
      const envelope = event.data;
      if (envelope?.kind === "hello") {
        channel.port2.postMessage({
          protocolVersion: 2,
          kind: "welcome",
          appInstanceId,
          hostInstanceId: "performance-host",
          hostEpoch,
          sdkVersion: "performance",
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
      const type = envelope.type;
      requests.push(type);
      let result = type === "session.tree"
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
              ? { snapshot, changes, sessionCatalogStatus, eventSequence: messageSequence, hostEpoch, sessionGeneration: 1 }
              : snapshot;
      if (type === "runtime.initialize" || type === "workspace.open") {
        sendEvent("runtime.ready", {
          capabilities: runtimeCapabilities,
          snapshot
        });
        result = projectionMutationAcknowledgement();
      }
      channel.port2.postMessage({
        protocolVersion: 2,
        kind: "response",
        requestId: envelope.requestId,
        hostEpoch,
        type,
        ok: true,
        result
      });
    };
    channel.port2.start();
    globalThis.__pi67Performance = {
      beginStreaming() {
        snapshot.streaming = true;
        sendEvent("operation.started", {
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
        sendEvent("session.metaChanged", {
          streaming: true,
          thinkingLevel: snapshot.thinkingLevel,
          selectedModel: snapshot.selectedModel
        });
      },
      emitStreamBatch(delta) {
        sendEvent("turn.streamBatch", {
          events: [{ assistantMessageEvent: { type: "text_delta", delta } }]
        }, operationId);
      },
      showMarkdown(markdown, messageId) {
        snapshot.streaming = false;
        messages = [{
          id: messageId,
          role: "assistant",
          parts: [{ type: "text", text: markdown }],
          createdAt: Date.now()
        }];
        sendEvent("conversation.changed", { sessionId: snapshot.sessionId, reason: "settled" });
      },
      switchSession(marker, nextMessageCount) {
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
        sendEvent("session.bootstrap", { snapshot, reason: "session-open" });
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
  }, messageCount);
}
