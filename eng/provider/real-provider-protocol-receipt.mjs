const TERMINAL_EVENT_TYPES = new Set([
  "operation.completed",
  "operation.failed",
  "operation.cancelled",
  "operation.lost"
]);
const CONTROL_RESPONSE_TYPES = new Set(["model.select", "thinking.set"]);

export function createRealProviderProtocolProbe() {
  return {
    hostEpoch: undefined,
    submitStartedAt: undefined,
    acceptedAt: undefined,
    operationId: undefined,
    approval: undefined,
    terminal: undefined,
    controlResponses: {}
  };
}

export function reduceRealProviderProtocolEnvelope(currentProbe, envelope, now = Date.now()) {
  const probe = sanitizeRealProviderProtocolProbe(currentProbe);
  if (
    envelope?.kind === "response"
    && CONTROL_RESPONSE_TYPES.has(envelope.type)
    && envelope.ok === true
  ) {
    return {
      ...probe,
      controlResponses: {
        ...probe.controlResponses,
        [envelope.type]: true
      }
    };
  }
  if (
    envelope?.kind === "response"
    && envelope.type === "prompt.submit"
    && envelope.ok === true
    && envelope.result?.kind === "accepted"
    && typeof envelope.result.operationId === "string"
    && envelope.result.operationId
  ) {
    return {
      ...probe,
      acceptedAt: probe.acceptedAt ?? now,
      operationId: probe.operationId ?? envelope.result.operationId
    };
  }
  if (
    envelope?.kind === "event"
    && envelope.type === "approval.requested"
    && !probe.approval
    && Number.isSafeInteger(envelope.sequence)
  ) {
    const approval = sanitizeProviderApproval(envelope.payload, envelope.sequence);
    return approval ? { ...probe, approval } : probe;
  }
  if (
    envelope?.kind === "event"
    && TERMINAL_EVENT_TYPES.has(envelope.type)
    && envelope.payload?.operationId === probe.operationId
    && !probe.terminal
    && Number.isSafeInteger(envelope.sequence)
  ) {
    return {
      ...probe,
      terminal: {
        type: envelope.type,
        at: now,
        sequence: envelope.sequence
      }
    };
  }
  return probe;
}

export function sanitizeRealProviderProtocolProbe(value) {
  const terminal = value?.terminal;
  return {
    hostEpoch: Number.isSafeInteger(value?.hostEpoch) ? value.hostEpoch : undefined,
    submitStartedAt: finiteTimestamp(value?.submitStartedAt),
    acceptedAt: finiteTimestamp(value?.acceptedAt),
    operationId: boundedString(value?.operationId, 256),
    approval: sanitizeProviderApproval(value?.approval, value?.approval?.sequence),
    controlResponses: Object.fromEntries([...CONTROL_RESPONSE_TYPES]
      .filter((type) => value?.controlResponses?.[type] === true)
      .map((type) => [type, true])),
    terminal: TERMINAL_EVENT_TYPES.has(terminal?.type)
      && finiteTimestamp(terminal?.at) !== undefined
      && Number.isSafeInteger(terminal?.sequence)
      ? {
          type: terminal.type,
          at: terminal.at,
          sequence: terminal.sequence
        }
      : undefined
  };
}

export async function installProtocolReceiptProbe(page) {
  await page.evaluate(({ controlResponseTypes, terminalEventTypes }) => {
    globalThis.__pi67ProviderLongTurnProbe = {
      hostEpoch: undefined,
      submitStartedAt: undefined,
      acceptedAt: undefined,
      operationId: undefined,
      approval: undefined,
      terminal: undefined,
      controlResponses: {}
    };
    const terminals = new Set(terminalEventTypes);
    const controls = new Set(controlResponseTypes);
    window.addEventListener("message", (event) => {
      const data = event.data;
      const port = event.ports[0];
      if (
        event.source !== window
        || data?.source !== "pi67-preload"
        || data?.type !== "agent-port"
        || !port
      ) return;
      const probe = globalThis.__pi67ProviderLongTurnProbe;
      if (!probe) return;
      probe.hostEpoch = data.hostEpoch;
      port.addEventListener("message", (messageEvent) => {
        const envelope = messageEvent.data;
        if (
          envelope?.kind === "response"
          && controls.has(envelope.type)
          && envelope.ok === true
        ) {
          probe.controlResponses[envelope.type] = true;
          return;
        }
        if (
          envelope?.kind === "response"
          && envelope.type === "prompt.submit"
          && envelope.ok === true
          && envelope.result?.kind === "accepted"
          && typeof envelope.result.operationId === "string"
          && envelope.result.operationId
        ) {
          probe.acceptedAt ??= Date.now();
          probe.operationId ??= envelope.result.operationId;
          return;
        }
        if (
          envelope?.kind === "event"
          && envelope.type === "approval.requested"
          && !probe.approval
          && Number.isSafeInteger(envelope.sequence)
        ) {
          const payload = envelope.payload;
          if (
            Number.isSafeInteger(payload?.hostEpoch)
            && typeof payload?.requestId === "string"
            && payload.requestId.length > 0
            && payload.requestId.length <= 512
            && typeof payload?.toolCallId === "string"
            && payload.toolCallId.length > 0
            && payload.toolCallId.length <= 512
            && typeof payload?.operationId === "string"
            && payload.operationId.length > 0
            && payload.operationId.length <= 512
            && typeof payload?.toolName === "string"
            && payload.toolName.length > 0
            && payload.toolName.length <= 256
            && ["command", "path", "tool"].includes(payload?.targetKind)
            && typeof payload?.target === "string"
            && payload.target.length > 0
            && payload.target.length <= 8_192
            && typeof payload?.cwd === "string"
            && payload.cwd.length > 0
            && payload.cwd.length <= 8_192
            && typeof payload?.targetTruncated === "boolean"
            && typeof payload?.cwdTruncated === "boolean"
            && payload?.scope === "single-tool-call"
          ) {
            probe.approval = {
              sequence: envelope.sequence,
              hostEpoch: payload.hostEpoch,
              requestId: payload.requestId,
              toolCallId: payload.toolCallId,
              operationId: payload.operationId,
              toolName: payload.toolName,
              targetKind: payload.targetKind,
              target: payload.target,
              targetTruncated: payload.targetTruncated,
              cwd: payload.cwd,
              cwdTruncated: payload.cwdTruncated,
              scope: payload.scope
            };
          }
          return;
        }
        if (
          envelope?.kind === "event"
          && terminals.has(envelope.type)
          && envelope.payload?.operationId === probe.operationId
          && !probe.terminal
          && Number.isSafeInteger(envelope.sequence)
        ) {
          probe.terminal = {
            type: envelope.type,
            at: Date.now(),
            sequence: envelope.sequence
          };
        }
      });
      port.start();
    });
  }, {
    controlResponseTypes: [...CONTROL_RESPONSE_TYPES],
    terminalEventTypes: [...TERMINAL_EVENT_TYPES]
  });
}

export async function waitForRealProviderControlResponse(page, type, timeoutMs = 30_000) {
  if (!CONTROL_RESPONSE_TYPES.has(type)) {
    throw new Error(`Unsupported Provider control response type: ${String(type)}.`);
  }
  await page.waitForFunction(
    (expectedType) => globalThis.__pi67ProviderLongTurnProbe?.controlResponses?.[expectedType] === true,
    type,
    { timeout: timeoutMs }
  );
}

export async function waitForRealProviderApprovalRequest(page, timeoutMs = 10_000) {
  await page.waitForFunction(
    () => globalThis.__pi67ProviderLongTurnProbe?.approval !== undefined,
    undefined,
    { timeout: timeoutMs }
  );
}

export async function markProviderPromptSubmission(page) {
  await page.evaluate(() => {
    const probe = globalThis.__pi67ProviderLongTurnProbe;
    if (!probe) throw new Error("Provider protocol receipt probe is unavailable.");
    probe.submitStartedAt = Date.now();
  });
}

export async function readRealProviderProtocolProbe(page) {
  const value = await page.evaluate(() => globalThis.__pi67ProviderLongTurnProbe);
  return sanitizeRealProviderProtocolProbe(value);
}

function finiteTimestamp(value) {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function boundedString(value, limit) {
  return typeof value === "string" && value.length > 0 && value.length <= limit
    ? value
    : undefined;
}

function sanitizeProviderApproval(value, sequence) {
  const approval = {
    sequence: Number.isSafeInteger(sequence) ? sequence : undefined,
    hostEpoch: Number.isSafeInteger(value?.hostEpoch) ? value.hostEpoch : undefined,
    requestId: boundedString(value?.requestId, 512),
    toolCallId: boundedString(value?.toolCallId, 512),
    operationId: boundedString(value?.operationId, 512),
    toolName: boundedString(value?.toolName, 256),
    targetKind: ["command", "path", "tool"].includes(value?.targetKind)
      ? value.targetKind
      : undefined,
    target: boundedString(value?.target, 8_192),
    targetTruncated: typeof value?.targetTruncated === "boolean"
      ? value.targetTruncated
      : undefined,
    cwd: boundedString(value?.cwd, 8_192),
    cwdTruncated: typeof value?.cwdTruncated === "boolean" ? value.cwdTruncated : undefined,
    scope: value?.scope === "single-tool-call" ? value.scope : undefined
  };
  return Object.values(approval).every((field) => field !== undefined) ? approval : undefined;
}
