import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const config = {
  enabled: true,
  peerId: "",
  privacyMode: "private-learning",
  bypassPatterns: [],
  takeoverEnabled: false,
  logLevel: "silent",
  profileTokenBudget: 1,
  resumeContextBudget: 1,
  recallTokenBudget: 1,
  recallPreferAbstract: true,
  syncTurns: false,
  captureAssistantTurns: true,
  privateWriteEnabled: true,
  enterpriseCandidateEnabled: false
} as any;
const setPeerId = vi.fn();
const explicitPeerByConfig = new WeakMap<object, boolean>();

function resetConfig(peerId = "") {
  config.peerId = peerId;
  explicitPeerByConfig.set(config, peerId !== "");
}

vi.mock("./config.js", () => ({
  loadConfigFromModuleUrl: () => config,
  bindWorkspacePeer: (target: typeof config, cwd: string) => {
    if (!explicitPeerByConfig.get(target)) {
      target.peerId = createHash("sha256").update(cwd).digest("hex");
    }
  }
}));
vi.mock("./client.js", () => ({
  OVClient: class {
    cfg = config;
    connected = true;
    setPeerId = setPeerId;
    onConnectionChange() {}
    ensureConnected = vi.fn(async () => true);
    fetchJSON = vi.fn(async () => ({ ok: true, result: {} }));
  }
}));
vi.mock("./sync.js", () => ({
  SyncManager: class {
    sessionId: string | null = null;
    restore() {}
    ensureSession = vi.fn(async () => true);
    replayPending = vi.fn(async () => undefined);
    alignBranch = vi.fn(async () => false);
    syncBranch = vi.fn(async () => ({ allDelivered: true, added: 0, tokens: 0 }));
    shutdown = vi.fn(async () => undefined);
    commit = vi.fn(async () => null);
  }
}));
vi.mock("./recall.js", () => ({ RecallManager: class { state = "idle"; invalidate() {}; queueSearch() {}; injectContext() { return []; } } }));
vi.mock("./takeover.js", () => ({ createTakeoverManager: () => ({ state: { syncedEntryCount: 0, pendingTokens: 0, coveredUserTurns: 0 }, restore() {}, onTurnSynced: async () => undefined, shutdown: async () => undefined, handleBeforeCompact: async () => undefined, commitAndAdvance: async () => false, transformContext: (value: unknown) => value }) }));
vi.mock("./tools.js", () => ({ OPENVIKING_MODEL_RECALL_POLICY: "policy", registerTools() {} }));
vi.mock("./diagnostics.js", () => ({ emitContextDiagnostic() {}, hashDiagnosticValue: () => "hash" }));
vi.mock("./memory-owner-policy.js", () => ({ detectMemoryOwnerConflict: () => null }));
vi.mock("./runtime-privacy.js", () => ({ createRuntimePrivacyGuard: () => () => true }));
vi.mock("./shared/profile-inject.mjs", () => ({ buildProfileBlock: async () => undefined }));
vi.mock("./lib/uri-guard-adapter.mjs", () => ({ guardVikingUriToolCall: () => null }));

import extension from "./index.js";

type Handler = (event: unknown, ctx: any) => Promise<unknown>;

function piFixture() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    pi: {
      on(type: string, handler: Handler) { handlers.set(type, handler); },
      registerCommand() {},
      appendEntry() {}
    }
  };
}

function context(cwd: string) {
  return { sessionManager: { getCwd: () => cwd, getSessionId: () => `session:${cwd}`, getBranch: () => [] }, ui: { notify() {}, setStatus() {} } };
}

describe("OpenViking Extension workspace peer lifecycle", () => {
  it("rebinds the real session_start path before its started fast path", async () => {
    resetConfig();
    setPeerId.mockClear();
    const fixture = piFixture();
    await extension(fixture.pi as any);
    const handler = fixture.handlers.get("session_start");
    if (!handler) throw new Error("Expected session_start handler");
    await handler({}, context("/workspace/a"));
    await handler({}, context("/workspace/b"));
    expect(setPeerId).toHaveBeenCalledTimes(2);
    expect(setPeerId.mock.calls.map(([peer]) => peer)).toEqual([
      createHash("sha256").update("/workspace/a").digest("hex"),
      createHash("sha256").update("/workspace/b").digest("hex")
    ]);
  });

  it("keeps an explicit peer across real session_start lifecycle calls", async () => {
    resetConfig("operator-peer");
    setPeerId.mockClear();
    const fixture = piFixture();
    await extension(fixture.pi as any);
    const handler = fixture.handlers.get("session_start");
    if (!handler) throw new Error("Expected session_start handler");
    await handler({}, context("/workspace/a"));
    await handler({}, context("/workspace/b"));
    expect(setPeerId.mock.calls.map(([peer]) => peer)).toEqual(["operator-peer", "operator-peer"]);
    resetConfig();
  });
});
