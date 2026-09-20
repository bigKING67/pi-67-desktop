import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { streamWithTeamLease } from "./team-model-stream.js";
import { bindSharedHistoryModelGuard } from "./shared-history-model-guard.js";
import { markTeamSessionBirth } from "./team-session-birth.js";

const model = { id: "fixture", provider: "fixture", api: "openai-responses", baseUrl: "https://fixture.invalid", maxTokens: 128 } as const;
function message(tool = false): AssistantMessage {
  return { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 1,
    content: tool ? [{ type: "toolCall", name: "fixture_tool", id: "call", arguments: {} }] : [{ type: "text", text: "fixture" }],
    stopReason: tool ? "toolUse" : "stop", usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("preserves model, context, options and valid Pi events, then removes its timer", async () => {
  vi.useFakeTimers();
  const source = createAssistantMessageEventStream(), result = message(), parent = new AbortController();
  const context = { messages: [] };
  const transport = vi.fn<StreamFn>(() => source);
  const output = streamWithTeamLease(transport, [model as never, context, { signal: parent.signal, maxTokens: 42 }], () => undefined);
  source.push({ type: "start", partial: result }); source.push({ type: "done", reason: "stop", message: result });
  const events = [];
  for await (const event of output) events.push(event);
  expect(events).toEqual([{ type: "start", partial: result }, { type: "done", reason: "stop", message: result }]);
  expect(await output.result()).toBe(result);
  expect(transport).toHaveBeenCalledExactlyOnceWith(model, context, { signal: expect.any(AbortSignal), maxTokens: 42 });
  expect(transport.mock.calls[0]?.[2]?.signal).not.toBe(parent.signal);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["event", "idle"])("terminates an invalid lease during %s and rejects late success", async (mode) => {
  vi.useFakeTimers();
  const source = createAssistantMessageEventStream();
  const valid = vi.fn();
  let signal: AbortSignal | undefined;
  const output = streamWithTeamLease((_model, _context, options) => { signal = options?.signal; return source; }, [model as never, { messages: [] }], valid);
  source.push({ type: "start", partial: message() });
  await vi.advanceTimersByTimeAsync(0);
  valid.mockImplementation(() => { throw new Error("lease expired"); });
  if (mode === "event") source.push({ type: "done", reason: "stop", message: message() });
  else await vi.advanceTimersByTimeAsync(1000);
  expect(await output.result()).toMatchObject({ stopReason: "error", errorMessage: "lease expired", content: [], usage: { input: 2 } });
  expect(signal?.aborted).toBe(true);
  source.push({ type: "done", reason: "toolUse", message: message(true) });
  const events = [];
  for await (const event of output) events.push(event);
  expect(events.map((event) => event.type)).toEqual(["start", "error"]);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([true, false])("honors caller cancellation before or during transport: preaborted=%s", async (preaborted) => {
  vi.useFakeTimers();
  const parent = new AbortController(), source = createAssistantMessageEventStream();
  const transport = vi.fn<StreamFn>(() => source);
  if (preaborted) parent.abort();
  const output = streamWithTeamLease(transport, [model as never, { messages: [] }, { signal: parent.signal }], () => undefined);
  parent.abort();
  expect(await output.result()).toMatchObject({ stopReason: "aborted", content: [] });
  expect(transport).toHaveBeenCalledTimes(preaborted ? 0 : 1);
  if (!preaborted) expect(transport.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
  source.end();
  expect(vi.getTimerCount()).toBe(0);
});

it("cleans up when transport throws or silently ends", async () => {
  vi.useFakeTimers();
  const throwing = streamWithTeamLease(() => { throw new Error("transport failed"); }, [model as never, { messages: [] }], () => undefined);
  expect(await throwing.result()).toMatchObject({ stopReason: "error", errorMessage: "transport failed" });
  const source = createAssistantMessageEventStream();
  const empty = streamWithTeamLease(() => source, [model as never, { messages: [] }], () => undefined);
  source.end();
  expect(await empty.result()).toMatchObject({ stopReason: "error", errorMessage: expect.stringContaining("without a terminal") });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["lease", "session"])("settles Pi after %s invalidation without executing late Tool calls even when the provider ignores abort", async (reason) => {
  vi.useFakeTimers();
  const manager = SessionManager.inMemory("/workspace");
  const identity = { userId: "user", teamId: "team", projectId: "project", endpoint: "https://fixture.invalid/" };
  markTeamSessionBirth(manager, identity);
  const source = createAssistantMessageEventStream(), execute = vi.fn(), assertValid = vi.fn();
  let signal: AbortSignal | undefined;
  const transport = vi.fn<StreamFn>((_model, _context, options) => { signal = options?.signal; return source; });
  const agent = new Agent({ initialState: { model: model as never, tools: [{ name: "fixture_tool", label: "fixture", description: "fixture",
    parameters: { type: "object", properties: {} } as never, execute }] }, streamFn: transport });
  const session = { agent, sessionManager: manager };
  bindSharedHistoryModelGuard(session as AgentSession, { authorizeTeamSession: async () => ({ identity, assertValid }) });
  const pending = agent.prompt("fixture");
  await vi.advanceTimersByTimeAsync(0);
  source.push({ type: "start", partial: message(true) });
  await vi.advanceTimersByTimeAsync(0);
  if (reason === "lease") assertValid.mockImplementation(() => { throw new Error("signed out"); });
  else session.sessionManager = SessionManager.inMemory("/other");
  await vi.advanceTimersByTimeAsync(1000);
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(agent.state.errorMessage).toBe(reason === "lease" ? "signed out" : "Team Session changed during the model request.");
  expect(agent.state.isStreaming).toBe(false);
  source.push({ type: "done", reason: "toolUse", message: message(true) });
  await vi.advanceTimersByTimeAsync(0);
  expect(execute).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
