import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import { afterEach, expect, it, vi } from "vitest";
import { bindSharedHistoryModelGuard } from "./shared-history-model-guard.js";
import { markTeamSessionBirth } from "./team-session-birth.js";

const identity = { userId: "user", teamId: "team", projectId: "project", endpoint: "https://server.invalid/" };
const model = { id: "fixture", provider: "fixture", api: "openai-responses", baseUrl: "https://model.invalid", maxTokens: 128 } as const;
const asset = { id: "asset", projectId: "project", externalRevision: "a".repeat(64) };
afterEach(() => { vi.useRealTimers(); });
function fixture(duration = 90_000, count = 1, beforeToolCall?: Agent["beforeToolCall"]) {
  vi.useFakeTimers();
  const manager = SessionManager.inMemory("/workspace");
  markTeamSessionBirth(manager, identity);
  manager.appendMessage({ role: "toolResult", toolName: "viking_shared_read", toolCallId: "basis", timestamp: 1, isError: false,
    content: [{ type: "text", text: "basis" }], details: { provider: "openviking-enterprise", trust: "untrusted", item: asset } });
  const authorize = vi.fn(async (_scope: unknown, _model: unknown, _signal?: AbortSignal) => {
    const deadline = Date.now() + duration;
    return { identity, assertValid() { if (Date.now() >= deadline) throw new Error("lease expired"); } };
  });
  const read = vi.fn(async () => asset as never);
  const finish: Array<() => void> = [];
  const execute = vi.fn<AgentTool["execute"]>(async () => {
    await new Promise<void>((resolve) => { finish.push(resolve); });
    return { content: [{ type: "text", text: "finished" }], details: {} };
  });
  let calls = 0;
  const transport = vi.fn(() => {
    const tool = calls++ === 0;
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 1,
      content: tool ? Array.from({ length: count }, (_, i) => ({ type: "toolCall", id: `call-${i}`, name: "ordinary", arguments: {} })) : [],
      stopReason: tool ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: tool ? "toolUse" : "stop", message });
    return stream;
  });
  const agent = new Agent({ initialState: { model: model as never, tools: [{ name: "ordinary", label: "ordinary", description: "fixture",
    parameters: { type: "object", properties: {} } as never, execute }] }, streamFn: transport,
    ...(beforeToolCall ? { beforeToolCall } : {}) });
  agent.subscribe((event) => {
    if (event.type === "message_end" && (event.message.role === "user" || event.message.role === "assistant" || event.message.role === "toolResult")) {
      manager.appendMessage(event.message);
    }
  });
  bindSharedHistoryModelGuard({ agent, sessionManager: manager } as AgentSession,
    { authorizeTeamSession: authorize, sharedExperienceAccess: { read, search: vi.fn() } });
  const pending = agent.prompt("fixture");
  return { agent, authorize, read, execute, transport, finish, pending };
}

it("shares minute renewal across parallel Tools and retains it until the last Tool settles", async () => {
  const f = fixture(90_000, 2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(f.read).toHaveBeenCalledTimes(2);
  f.finish[0]!(); await vi.advanceTimersByTimeAsync(120_000);
  expect(f.authorize).toHaveBeenCalledTimes(4);
  expect(f.execute.mock.calls.every((call) => !call[2]?.aborted)).toBe(true);
  expect(f.agent.state.isStreaming).toBe(true);
  f.finish[1]!(); await f.pending;
  expect(f.transport).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("renews during a long approval, executes once after approval, and stops polling when idle", async () => {
  let approve!: () => void;
  const f = fixture(90_000, 1, async () => {
    await new Promise<void>((resolve) => { approve = resolve; });
    return undefined;
  });
  await vi.advanceTimersByTimeAsync(180_000);
  expect(f.authorize).toHaveBeenCalledTimes(4);
  expect(f.read).toHaveBeenCalledTimes(4);
  expect(f.execute).not.toHaveBeenCalled();
  approve(); await vi.advanceTimersByTimeAsync(0);
  expect(f.execute).toHaveBeenCalledOnce();
  f.finish[0]!(); await f.pending;
  const authorizations = f.authorize.mock.calls.length;
  await vi.advanceTimersByTimeAsync(600_000);
  expect(f.authorize).toHaveBeenCalledTimes(authorizations);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["denied", "offline", "cancelled", "hook-error"])("does not execute after invalidation or failure during approval: %s", async (reason) => {
  let approve!: () => void;
  const f = fixture(90_000, 1, async () => {
    await new Promise<void>((resolve) => { approve = resolve; });
    if (reason === "hook-error") throw new Error("fixture approval failure");
    return undefined;
  });
  await vi.advanceTimersByTimeAsync(0);
  if (reason === "denied") f.authorize.mockRejectedValue(new Error("permission denied"));
  if (reason === "offline") f.authorize.mockRejectedValue(new RuntimeError("RUNTIME_NOT_READY", "offline", { details: { kind: "enterprise-transport-unavailable" } }));
  if (reason === "cancelled") f.agent.abort();
  await vi.advanceTimersByTimeAsync(reason === "offline" ? 90_000 : 60_000);
  approve(); await f.pending;
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.transport).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["permission", "revision", "identity", "unclassified"])("cancels active Tools on renewal %s denial", async (kind) => {
  const f = fixture(); await vi.advanceTimersByTimeAsync(0);
  if (kind === "permission") f.authorize.mockRejectedValue(new Error("permission denied"));
  if (kind === "revision") f.read.mockResolvedValue({ ...asset, externalRevision: "b".repeat(64) } as never);
  if (kind === "identity") f.authorize.mockResolvedValue({ identity: { ...identity, userId: "other" }, assertValid() {} });
  if (kind === "unclassified") f.authorize.mockRejectedValue(new RuntimeError("RUNTIME_NOT_READY", "unknown failure"));
  await vi.advanceTimersByTimeAsync(61_000);
  expect(f.execute.mock.calls[0]![2]!.aborted).toBe(true);
  expect(f.agent.state.isStreaming).toBe(true);
  f.finish[0]!(); await f.pending;
  expect(f.transport).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["authorization", "asset"])("keeps only the old fixed lease on classified %s transport failure", async (stage) => {
  const f = fixture(); await vi.advanceTimersByTimeAsync(0);
  const error = new RuntimeError("RUNTIME_NOT_READY", "offline", { details: { kind: "enterprise-transport-unavailable" } });
  if (stage === "authorization") f.authorize.mockRejectedValue(error); else f.read.mockRejectedValue(error);
  await vi.advanceTimersByTimeAsync(89_999);
  expect(f.execute.mock.calls[0]![2]!.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.execute.mock.calls[0]![2]!.aborted).toBe(true);
  f.finish[0]!(); await f.pending;
  expect(f.transport).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not revive an expired run, but freshly authorizes a later user-initiated run", async () => {
  const f = fixture(30_000);
  await vi.advanceTimersByTimeAsync(30_000);
  f.finish[0]!(); await f.pending;
  expect(f.authorize).toHaveBeenCalledOnce();
  expect(f.transport).toHaveBeenCalledOnce();
  await f.agent.prompt("new user request");
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(f.transport).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["expired", "completed", "aborted"])("cancels single-flight renewal and rejects late success when %s", async (reason) => {
  const f = fixture(reason === "expired" ? 90_000 : 300_000); await vi.advanceTimersByTimeAsync(0);
  let resolve!: (value: { identity: typeof identity; assertValid(): void }) => void;
  f.authorize.mockImplementation(() => new Promise((done) => { resolve = done; }));
  await vi.advanceTimersByTimeAsync(60_000);
  const refreshSignal = f.authorize.mock.calls[1]![2]!;
  if (reason === "expired") await vi.advanceTimersByTimeAsync(30_000);
  else if (reason === "aborted") f.agent.abort();
  else {
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.authorize).toHaveBeenCalledTimes(2);
    // Let the next model authorization fail independently instead of leaving it pending.
    f.authorize.mockRejectedValue(new Error("next request fixture denied"));
    f.finish[0]!(); await f.pending;
  }
  expect(refreshSignal.aborted).toBe(true);
  resolve({ identity, assertValid() {} }); await vi.advanceTimersByTimeAsync(0);
  if (reason !== "completed") { f.finish[0]!(); await f.pending; }
  expect(f.transport).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
