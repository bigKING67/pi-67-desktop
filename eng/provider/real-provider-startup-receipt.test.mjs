import { afterEach, describe, expect, it, vi } from "vitest";
import { installProviderStartupReceipt, readProviderStartupSelection } from "./real-provider-startup-receipt.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.__pi67ProviderStartupReceipt;
  delete globalThis.__pi67ProviderLongTurnProbe;
});

function fixture() {
  let connect;
  const window = { addEventListener: (_type, listener) => { connect = listener; } };
  vi.stubGlobal("window", window);
  installProviderStartupReceipt();
  let receive;
  connect({ source: window, data: { source: "pi67-preload", type: "agent-port", hostEpoch: 7 },
    ports: [{ addEventListener: (_type, listener) => { receive = listener; }, start() {} }] });
  const context = { scope: "task", workspaceId: "workspace", taskId: "task", taskGeneration: 1,
    sessionId: "session", sessionFileIdentity: "file", sessionGeneration: 2 };
  return {
    state: globalThis.__pi67ProviderStartupReceipt,
    send: (type, result, overrides = {}) => receive({ data: {
      kind: "response", ok: true, hostEpoch: 7, context, type, result, ...overrides
    } }), context
  };
}
const controls = { sessionId: "session", controls: {
  selectedModel: { provider: "provider", id: "model" }, thinkingLevel: "high"
} };
const ack = { kind: "accepted", operationId: "operation" };
const config = { providerId: "provider", modelId: "model", thinkingLevel: "high" };
const page = { evaluate: async (fn) => fn() };

describe("Provider first Prompt startup proof", () => {
  it("observes the actual installed listener and freezes bounded effective controls at acknowledgement", async () => {
    const f = fixture();
    f.send("thinking.set", controls);
    expect(f.state.controls).toBeUndefined();
    f.state.armed = true;
    f.send("thinking.set", { ...controls, credential: "must-not-retain" });
    f.send("prompt.submit", ack);
    f.send("thinking.set", { ...controls, controls: { ...controls.controls, thinkingLevel: "off" } });
    globalThis.__pi67ProviderLongTurnProbe = { operationId: "operation" };
    await expect(readProviderStartupSelection(page, config)).resolves.toMatchObject({
      modelValue: "provider/model", effectiveThinkingLevel: "high",
      authority: { sessionId: "session", sessionGeneration: 2, operationId: "operation" }
    });
    expect(JSON.stringify(f.state)).not.toContain("must-not-retain");
  });
  it.each(["workspaceId", "taskId", "taskGeneration", "sessionId", "sessionFileIdentity", "sessionGeneration"])(
    "rejects a control receipt from a different %s", async (field) => {
      const f = fixture(); f.state.armed = true;
      f.send("thinking.set", controls);
      f.send("prompt.submit", ack, { context: { ...f.context, [field]: typeof f.context[field] === "number" ? 9 : "other" } });
      globalThis.__pi67ProviderLongTurnProbe = { operationId: "operation" };
      await expect(readProviderStartupSelection(page, config)).rejects.toThrow("do not match");
    }
  );
  it("rejects stale epochs, missing control evidence and an unexpected effective model", async () => {
    const f = fixture(); f.state.armed = true;
    f.send("thinking.set", controls, { hostEpoch: 6 });
    expect(f.state.controls).toBeUndefined();
    f.send("thinking.set", { ...controls, controls: { ...controls.controls, selectedModel: { provider: "other", id: "model" } } });
    f.send("prompt.submit", ack);
    globalThis.__pi67ProviderLongTurnProbe = { operationId: "operation" };
    await expect(readProviderStartupSelection(page, config)).rejects.toThrow("do not match");
  });
});
