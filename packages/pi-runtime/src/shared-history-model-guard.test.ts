import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { bindSharedHistoryModelGuard } from "./shared-history-model-guard.js";
import { initializePrivateMemoryProvenance, markSharedMemoryProvenance } from "./session-memory-provenance.js";
import { markTeamSessionBirth } from "./team-session-birth.js";
import type { TeamHistoryAccess } from "./team-history-authorization.js";

const model = { id: "fixture", provider: "fixture", api: "openai-responses", baseUrl: "https://fixture.invalid", maxTokens: 128 } as const;
const identity = { userId: "user", teamId: "team", projectId: "project", endpoint: "https://server.invalid/" };
const sharedItem = { id: "asset", projectId: "project", externalRevision: "a".repeat(64) };
function response(tool: boolean): AssistantMessage {
  return { role: "assistant", api: "openai-responses", provider: "fixture", model: "fixture", timestamp: 1,
    content: tool ? [{ type: "toolCall", id: "shared-call", name: "shared", arguments: {} }] : [{ type: "text", text: "private" }],
    stopReason: tool ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function fixture(withTool = false, access?: TeamHistoryAccess) {
  const manager = SessionManager.inMemory("/workspace");
  if (access) markTeamSessionBirth(manager, identity); else initializePrivateMemoryProvenance(manager);
  let iterations = 0;
  const transport = vi.fn(() => {
    const stream = createAssistantMessageEventStream();
    const message = response(withTool && iterations++ === 0);
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
    return stream;
  });
  const agent = new Agent({ initialState: { model: model as never, tools: withTool ? [{
    name: "shared", label: "shared", description: "fixture", parameters: { type: "object", properties: {} } as never,
    execute: async () => {
      if (access) manager.appendMessage({ role: "toolResult", toolName: "viking_shared_read", toolCallId: "shared-call", timestamp: 1,
        isError: false, content: [{ type: "text", text: "shared result" }], details: { provider: "openviking-enterprise", trust: "untrusted", item: sharedItem } });
      else markSharedMemoryProvenance(manager);
      return { content: [{ type: "text", text: "shared result" }], details: {} };
    }
  }] : [] }, streamFn: transport });
  const session = { agent, sessionManager: manager } as AgentSession;
  bindSharedHistoryModelGuard(session, access);
  return { agent, manager, session, transport };
}

it("preserves private Pi execution and binds idempotently", async () => {
  const { agent, session, transport } = fixture();
  const guard = agent.streamFunction;
  bindSharedHistoryModelGuard(session);
  expect(agent.streamFunction).toBe(guard);
  await agent.prompt("private fixture");
  expect(transport).toHaveBeenCalledOnce();
});

it.each([false, true])("checks the actual Pi loop again after shared Tool history; revoked=%s", async (revoked) => {
  const authorizeTeamSession = vi.fn(async () => ({ identity, assertValid() {} }));
  const read = vi.fn(async () => {
    if (revoked) throw new Error("revoked fixture asset");
    return sharedItem as never;
  });
  const { agent, transport } = fixture(true, { authorizeTeamSession, sharedExperienceAccess: { read, search: vi.fn() } });
  await agent.prompt("fixture");
  expect(authorizeTeamSession).toHaveBeenCalledTimes(2);
  expect(authorizeTeamSession).toHaveBeenLastCalledWith(identity, { baseUrl: model.baseUrl, id: model.id }, expect.any(AbortSignal));
  expect(read).toHaveBeenCalledExactlyOnceWith("asset", expect.any(AbortSignal), { baseUrl: model.baseUrl, id: model.id, scope: identity });
  expect(transport).toHaveBeenCalledTimes(revoked ? 1 : 2);
  expect(agent.state.errorMessage).toBe(revoked ? "revoked fixture asset" : undefined);
});

it("blocks restored or rewound shared history before the first transport", async () => {
  const { agent, manager, transport } = fixture();
  const privateLeaf = manager.getLeafId()!;
  markSharedMemoryProvenance(manager);
  manager.branch(privateLeaf);
  await agent.prompt("continue");
  expect(agent.state.errorMessage).toContain("verified team Session");
  expect(agent.state.isStreaming).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});

it("blocks the next iteration of the actual Pi loop after a Tool admits shared provenance", async () => {
  const { agent, transport } = fixture(true);
  await agent.prompt("request fixture tool");
  expect(agent.state.errorMessage).toContain("verified team Session");
  expect(agent.state.isStreaming).toBe(false);
  expect(transport).toHaveBeenCalledOnce();
  expect(agent.state.messages.some((message) => message.role === "toolResult")).toBe(true);
});
