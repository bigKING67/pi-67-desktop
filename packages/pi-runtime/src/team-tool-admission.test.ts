import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { bindSharedHistoryModelGuard } from "./shared-history-model-guard.js";
import { initializePrivateMemoryProvenance } from "./session-memory-provenance.js";
import { markTeamSessionBirth } from "./team-session-birth.js";

const identity = { userId: "user", teamId: "team", projectId: "project", endpoint: "https://server.invalid/" };
const model = { id: "fixture", provider: "fixture", api: "openai-responses", baseUrl: "https://model.invalid", maxTokens: 128 } as const;

afterEach(() => { vi.useRealTimers(); });

function fixture(team = true, toolCount = 1) {
  const manager = SessionManager.inMemory("/workspace");
  if (team) markTeamSessionBirth(manager, identity); else initializePrivateMemoryProvenance(manager);
  let valid = true;
  let calls = 0;
  const execute = vi.fn<AgentTool["execute"]>(async () => ({ content: [{ type: "text", text: "executed" }], details: {} }));
  const hook = vi.fn<NonNullable<Agent["beforeToolCall"]>>(async () => undefined);
  const transport = vi.fn(() => {
    const tool = calls++ === 0;
    const message: AssistantMessage = { role: "assistant", api: "openai-responses", provider: "fixture", model: "fixture", timestamp: 1,
      content: tool ? Array.from({ length: toolCount }, (_, index) => ({ type: "toolCall", id: `call-${index}`, name: "ordinary", arguments: {} })) : [],
      stopReason: tool ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: tool ? "toolUse" : "stop", message });
    return stream;
  });
  const agent = new Agent({ initialState: { model: model as never, tools: [{ name: "ordinary", label: "ordinary", description: "fixture",
    parameters: { type: "object", properties: {} } as never, execute }] }, streamFn: transport, beforeToolCall: hook });
  const session = { agent, sessionManager: manager } as AgentSession;
  bindSharedHistoryModelGuard(session, { authorizeTeamSession: async () => ({ identity,
    assertValid() { if (!valid) throw new Error("fixture grant invalidated"); } }) });
  return { agent, session, execute, hook, transport, revoke() { valid = false; } };
}

it("preserves approved ordinary Tool execution and existing hook arguments", async () => {
  const f = fixture();
  await f.agent.prompt("fixture");
  expect(f.execute).toHaveBeenCalledOnce();
  expect(f.hook).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ toolCall: expect.objectContaining({ name: "ordinary" }) }), expect.any(AbortSignal));
  expect(f.transport).toHaveBeenCalledTimes(2);
});

it("rejects a known invalid grant before entering existing approval hooks", async () => {
  const f = fixture();
  f.agent.subscribe((event) => { if (event.type === "tool_execution_start") f.revoke(); });
  await f.agent.prompt("fixture");
  expect(f.hook).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.transport).toHaveBeenCalledOnce();
  expect(f.agent.state.messages).toContainEqual(expect.objectContaining({ role: "toolResult", isError: true,
    content: [{ type: "text", text: "fixture grant invalidated" }] }));
});

it.each(["revoked", "session", "aborted"])("rechecks after pending approval: %s", async (change) => {
  const f = fixture();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  f.hook.mockImplementation(async () => { entered(); await new Promise<void>((resolve) => { release = resolve; }); return undefined; });
  const pending = f.agent.prompt("fixture");
  await waiting;
  if (change === "revoked") f.revoke();
  if (change === "session") Object.assign(f.session, { sessionManager: SessionManager.inMemory("/other") });
  if (change === "aborted") f.agent.abort();
  release(); await pending;
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.transport).toHaveBeenCalledOnce();
  expect(f.agent.state.isStreaming).toBe(false);
});

it.each([false, true])("retains existing safety denial without executing Tools; team=%s", async (team) => {
  const f = fixture(team);
  f.hook.mockResolvedValue({ block: true, terminate: true, reason: "fixture safety denial" });
  await f.agent.prompt("fixture");
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.agent.state.messages).toContainEqual(expect.objectContaining({ role: "toolResult", isError: true,
    content: [{ type: "text", text: "fixture safety denial" }] }));
});

it("fences an already-prepared parallel call when a later approval invalidates the grant", async () => {
  const f = fixture(true, 2);
  f.hook.mockImplementation(async ({ toolCall }) => {
    if (toolCall.id === "call-1") f.revoke();
    return undefined;
  });
  await f.agent.prompt("fixture");
  expect(f.hook).toHaveBeenCalledTimes(2);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.transport).toHaveBeenCalledOnce();
  expect(f.agent.state.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
});

it.each(["parallel", "sequential"] as const)("keeps Pi %s scheduling and executes each valid call once", async (mode) => {
  const f = fixture(true, 2);
  f.agent.toolExecution = mode;
  await f.agent.prompt("fixture");
  expect(f.execute).toHaveBeenCalledTimes(2);
  expect(f.execute.mock.calls.map(([id]) => id)).toEqual(["call-0", "call-1"]);
});

it.each(["revoked", "aborted"])("cancels a running Tool but waits for ignored cancellation to settle: %s", async (reason) => {
  vi.useFakeTimers();
  const f = fixture();
  const updates: unknown[] = [];
  f.agent.subscribe((event) => { if (event.type === "tool_execution_update") updates.push(event.partialResult); });
  let finish!: () => void;
  f.execute.mockImplementation(async (_id, _args, _signal, onUpdate) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    onUpdate?.({ content: [{ type: "text", text: "late update" }], details: {} });
    return { content: [{ type: "text", text: "late success" }], details: {} };
  });
  const pending = f.agent.prompt("fixture");
  await vi.advanceTimersByTimeAsync(0);
  const signal = f.execute.mock.calls[0]![2]!;
  expect(signal.aborted).toBe(false);
  if (reason === "revoked") f.revoke(); else f.agent.abort();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(signal.aborted).toBe(true);
  expect(f.agent.state.isStreaming).toBe(true);
  expect(f.agent.state.pendingToolCalls.size).toBe(1);
  finish(); await pending;
  expect(updates).toEqual([]);
  expect(f.agent.state.messages).toContainEqual(expect.objectContaining({ role: "toolResult", isError: true,
    content: [{ type: "text", text: expect.stringContaining("prior side effects may remain") }] }));
  expect(f.agent.state.isStreaming).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(f.transport).toHaveBeenCalledOnce();
});

it.each([false, true])("preserves valid updates and cleans execution timers after Tool settlement; throws=%s", async (throws) => {
  vi.useFakeTimers();
  const f = fixture();
  const updates: unknown[] = [];
  f.agent.subscribe((event) => { if (event.type === "tool_execution_update") updates.push(event.partialResult); });
  f.execute.mockImplementation(async (_id, _args, _signal, onUpdate) => {
    onUpdate?.({ content: [{ type: "text", text: "valid update" }], details: {} });
    if (throws) throw new Error("fixture Tool failure");
    return { content: [{ type: "text", text: "valid result" }], details: {} };
  });
  await f.agent.prompt("fixture");
  expect(updates).toEqual([{ content: [{ type: "text", text: "valid update" }], details: {} }]);
  expect(f.agent.state.messages).toContainEqual(expect.objectContaining({ role: "toolResult", isError: throws,
    content: [{ type: "text", text: throws ? "fixture Tool failure" : "valid result" }] }));
  expect(vi.getTimerCount()).toBe(0);
});
