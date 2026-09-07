// Executed in the sandboxed Renderer. Keep this function self-contained and project
// only bounded identity/control fields: never retain raw protocol or credential data.
export function installProviderStartupReceipt() {
  const state = { armed: false, hostEpoch: undefined, controls: undefined, accepted: undefined };
  globalThis.__pi67ProviderStartupReceipt = state;
  const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 512;
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const identity = (envelope) => {
    const context = envelope.context;
    if (context?.scope !== "task" || !integer(envelope.hostEpoch)
      || !integer(context.taskGeneration) || !integer(context.sessionGeneration)
      || ![context.workspaceId, context.taskId, context.sessionId, context.sessionFileIdentity].every(text)) {
      return undefined;
    }
    return {
      hostEpoch: envelope.hostEpoch,
      workspaceId: context.workspaceId,
      taskId: context.taskId,
      taskGeneration: context.taskGeneration,
      sessionId: context.sessionId,
      sessionFileIdentity: context.sessionFileIdentity,
      sessionGeneration: context.sessionGeneration
    };
  };
  window.addEventListener("message", (event) => {
    const port = event.ports[0];
    if (event.source !== window || event.data?.source !== "pi67-preload"
      || event.data?.type !== "agent-port" || !port || !integer(event.data.hostEpoch)) return;
    state.hostEpoch = event.data.hostEpoch;
    state.controls = undefined;
    state.accepted = undefined;
    const portEpoch = state.hostEpoch;
    port.addEventListener("message", ({ data: envelope }) => {
      if (!state.armed || state.accepted || state.hostEpoch !== portEpoch
        || envelope?.hostEpoch !== portEpoch || envelope.kind !== "response" || envelope.ok !== true) return;
      const authority = identity(envelope);
      if (!authority) return;
      if (envelope.type === "thinking.set") {
        const controls = envelope.result?.controls;
        const model = controls?.selectedModel;
        if (envelope.result?.sessionId !== authority.sessionId
          || !text(model?.provider) || !text(model?.id) || !text(controls?.thinkingLevel)) {
          state.controls = undefined;
          return;
        }
        state.controls = {
          ...authority, provider: model.provider, model: model.id, thinkingLevel: controls.thinkingLevel
        };
      } else if (envelope.type === "prompt.submit" && envelope.result?.kind === "accepted"
        && text(envelope.result.operationId)) {
        const controls = state.controls;
        const matches = controls && Object.keys(authority).every((key) => controls[key] === authority[key]);
        state.accepted = {
          ...authority, operationId: envelope.result.operationId,
          controls: matches ? controls : undefined
        };
      }
    });
    port.start();
  });
}

export async function readProviderStartupSelection(page, config) {
  const accepted = await page.evaluate(() => globalThis.__pi67ProviderStartupReceipt?.accepted);
  const controls = accepted?.controls;
  const operationId = await page.evaluate(() => globalThis.__pi67ProviderLongTurnProbe?.operationId);
  if (!controls || accepted.operationId !== operationId
    || controls.provider !== config.providerId || controls.model !== config.modelId
    || controls.thinkingLevel !== config.thinkingLevel) {
    throw new Error("Provider startup controls do not match the accepted Prompt Session and requested configuration.");
  }
  return {
    modelValue: `${controls.provider}/${controls.model}`,
    effectiveThinkingLevel: controls.thinkingLevel,
    authority: {
      hostEpoch: accepted.hostEpoch, taskId: accepted.taskId,
      taskGeneration: accepted.taskGeneration, sessionId: accepted.sessionId,
      sessionFileIdentity: accepted.sessionFileIdentity, sessionGeneration: accepted.sessionGeneration,
      workspaceId: accepted.workspaceId, operationId: accepted.operationId
    }
  };
}
