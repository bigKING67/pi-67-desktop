import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import { afterEach, expect, it, vi } from "vitest";
import { bindSharedHistoryModelGuard } from "./shared-history-model-guard.js";
import { markTeamSessionBirth } from "./team-session-birth.js";

const identity = { userId: "user", teamId: "team", projectId: "project", endpoint: "https://fixture.invalid/" };
const model = { id: "fixture", provider: "fixture", api: "openai-responses", baseUrl: "https://model.invalid", maxTokens: 128 } as const;
const asset = { id: "asset", projectId: "project", externalRevision: "a".repeat(64) };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture(duration = 300_000) {
  vi.useFakeTimers();
  const manager = SessionManager.inMemory("/workspace");
  markTeamSessionBirth(manager, identity);
  manager.appendMessage({ role: "toolResult", toolName: "viking_shared_read", toolCallId: "call", timestamp: 1, isError: false,
    content: [{ type: "text", text: "fixture" }], details: { provider: "openviking-enterprise", trust: "untrusted", item: asset } });
  const authorize = vi.fn(async (_scope: unknown, _model: unknown, _signal?: AbortSignal) => {
    const deadline = Date.now() + duration;
    return { identity, assertValid() { if (Date.now() >= deadline) throw new Error("lease expired"); } };
  });
  const read = vi.fn(async () => asset as never);
  const source = createAssistantMessageEventStream();
  const transport = vi.fn<StreamFn>(() => source);
  const agent = new Agent({ initialState: { model: model as never }, streamFn: transport });
  bindSharedHistoryModelGuard({ agent, sessionManager: manager } as AgentSession, {
    authorizeTeamSession: authorize, sharedExperienceAccess: { read, search: vi.fn() }
  });
  const pending = agent.prompt("fixture");
  const finish = async () => {
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 1,
      content: [], stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    source.push({ type: "done", reason: "stop", message }); await pending;
  };
  return { agent, authorize, read, transport, source, pending, finish };
}

it("renews once per minute only after identity, policy and every historical revision pass", async () => {
  const f = fixture(90_000);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(f.authorize).toHaveBeenCalledTimes(4);
  expect(f.read).toHaveBeenCalledTimes(4);
  expect(f.transport).toHaveBeenCalledOnce();
  expect(f.agent.state.isStreaming).toBe(true);
  await f.finish();
  expect(f.agent.state.errorMessage).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["permission", "revision", "identity", "unclassified"])("terminates the same Pi request on refresh %s denial", async (kind) => {
  const f = fixture(); await vi.advanceTimersByTimeAsync(0);
  if (kind === "permission") f.authorize.mockRejectedValue(new Error("permission denied"));
  if (kind === "revision") f.read.mockResolvedValue({ ...asset, externalRevision: "b".repeat(64) } as never);
  if (kind === "identity") f.authorize.mockResolvedValue({ identity: { ...identity, userId: "other" }, assertValid() {} });
  if (kind === "unclassified") f.authorize.mockRejectedValue(new RuntimeError("RUNTIME_NOT_READY", "unknown recoverable failure"));
  await vi.advanceTimersByTimeAsync(60_000); await f.pending;
  expect(f.agent.state.errorMessage).toBeDefined();
  expect(f.transport.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  f.source.end();
});

it.each(["authorization", "asset"])("retains but never extends the old lease during classified %s transport outages", async (stage) => {
  const f = fixture(); await vi.advanceTimersByTimeAsync(0);
  const error = new RuntimeError("RUNTIME_NOT_READY", "offline", { details: { kind: "enterprise-transport-unavailable" } });
  if (stage === "authorization") f.authorize.mockRejectedValue(error); else f.read.mockRejectedValue(error);
  await vi.advanceTimersByTimeAsync(299_999);
  expect(f.agent.state.isStreaming).toBe(true);
  expect(f.authorize).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(1); await f.pending;
  expect(f.agent.state.errorMessage).toBe("lease expired");
  expect(vi.getTimerCount()).toBe(0); f.source.end();
});

it.each(["expired", "completed"])("cancels a single-flight pending refresh when the request is %s; late success cannot revive it", async (reason) => {
  const f = fixture(reason === "expired" ? 90_000 : 300_000); await vi.advanceTimersByTimeAsync(0);
  let resolve!: (value: { identity: typeof identity; assertValid(): void }) => void;
  f.authorize.mockImplementation(() => new Promise((done) => { resolve = done; }));
  await vi.advanceTimersByTimeAsync(60_000);
  const refreshSignal = f.authorize.mock.calls[1]?.[2];
  expect(refreshSignal?.aborted).toBe(false);
  if (reason === "expired") { await vi.advanceTimersByTimeAsync(30_000); await f.pending; }
  else { await vi.advanceTimersByTimeAsync(120_000); expect(f.authorize).toHaveBeenCalledTimes(2); await f.finish(); }
  expect(refreshSignal?.aborted).toBe(true);
  resolve({ identity, assertValid() {} });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(f.transport).toHaveBeenCalledOnce();
  expect(f.agent.state.errorMessage).toBe(reason === "expired" ? "lease expired" : undefined);
  expect(vi.getTimerCount()).toBe(0); f.source.end();
});
