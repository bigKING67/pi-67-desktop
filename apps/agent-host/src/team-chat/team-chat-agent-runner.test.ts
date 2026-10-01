import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeamChatAgent, TeamChatAgentActivity } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import { TeamChatAgentBindingStore } from "./team-chat-agent-bindings.js";
import type { TeamChatAgentGateway } from "./team-chat-agent-gateway.js";
import { TeamChatAgentRunner } from "./team-chat-agent-runner.js";
import { TeamChatAgentTurnError, type TeamChatAgentTurnInput } from "./team-chat-agent-turns.js";

const access = { endpoint: "https://nm.example.test", accessToken: "a", teamId: "t1", userId: "owner" };
const agent: TeamChatAgent = { userId: "agent", name: "研究助手", description: "", ownerUserId: "owner", modelLabel: "",
  dailyLimit: 50, status: "active", disabledByAdmin: false, online: true, createdAt: 1 };
const claim = {
  leaseToken: "lease-1",
  invocation: { id: "inv-1", agentUserId: "agent", conversationId: "c1", messageId: "m1", messageSeq: 3, invokerUserId: "u2", expiresAt: 9e12 },
  conversationKind: "channel" as const,
  conversationName: "宏观研究",
  messages: [{ id: "m1", conversationId: "c1", seq: 3, senderUserId: "u2", body: "@研究助手 总结", clientKey: "k-000001", createdAt: 1 }]
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function harness(options: {
  bound?: boolean; claimFails?: boolean | string; ready?: boolean; turnTimeoutMs?: number; turn?: (input: TeamChatAgentTurnInput) => Promise<string>;
} = {}) {
  const bindings = new TeamChatAgentBindingStore(await mkdtemp(join(tmpdir(), "pi67-runner-")));
  if (options.bound !== false) {
    await bindings.put("t1", { agentUserId: "agent", workspaceId: "w1", projectId: "p1", model: { provider: "anthropic", id: "claude" }, enabled: true });
  }
  const gateway = {
    claimInvocation: vi.fn(async () => {
      if (options.claimFails) {
        throw Object.assign(new Error("taken"), { details: { serviceError: typeof options.claimFails === "string" ? options.claimFails : "chat_agent_invocation_unavailable" } });
      }
      return claim;
    }),
    listMembers: vi.fn(async () => [{ userId: "owner", displayName: "高乾", role: "owner" }, { userId: "u2", displayName: "王一凡", role: "member" }]),
    listAgents: vi.fn(async () => [agent]),
    completeInvocation: vi.fn(async () => ({})),
    failInvocation: vi.fn(async () => undefined),
    pendingInvocations: vi.fn(async () => [claim.invocation])
  };
  const turns = { ready: vi.fn(() => options.ready ?? true), run: vi.fn(options.turn ?? (async () => "本周要点：利率下行。")) };
  const activity: TeamChatAgentActivity[][] = [];
  const runner = new TeamChatAgentRunner({
    access: async () => access, bindings, turns,
    onActivity: (items) => activity.push([...items]),
    gateway: () => gateway as unknown as TeamChatAgentGateway,
    ...(options.turnTimeoutMs === undefined ? {} : { turnTimeoutMs: options.turnTimeoutMs })
  });
  return { runner, gateway, turns, activity };
}

describe("TeamChatAgentRunner", () => {
  it("claims, runs a team-scoped turn in the bound Workspace and posts the reply once", async () => {
    const { runner, gateway, turns, activity } = await harness();
    runner.enqueue("inv-1", "agent");
    runner.enqueue("inv-1", "agent");
    await vi.waitFor(() => expect(gateway.completeInvocation).toHaveBeenCalledTimes(1));
    const input = turns.run.mock.calls[0]![0] as TeamChatAgentTurnInput;
    expect(input).toMatchObject({ workspaceId: "w1", teamScope: { teamId: "t1", projectId: "p1" }, model: { provider: "anthropic", id: "claude" },
      sessionName: "Agent · 研究助手 · #宏观研究" });
    expect(input.prompt).toContain("王一凡：@研究助手 总结");
    expect(gateway.completeInvocation).toHaveBeenCalledWith("inv-1", { clientKey: "agent-inv-1", body: "本周要点：利率下行。", leaseToken: "lease-1" });
    expect(activity.at(-1)?.[0]).toMatchObject({ invocationId: "inv-1", state: "replied" });
  });

  it("leaves requests for Agents this Desktop does not host and ones already claimed elsewhere", async () => {
    const unbound = await harness({ bound: false });
    unbound.runner.enqueue("inv-1", "agent");
    await flush();
    expect(unbound.gateway.claimInvocation).not.toHaveBeenCalled();
    const taken = await harness({ claimFails: true });
    taken.runner.enqueue("inv-1", "agent");
    await vi.waitFor(() => expect(taken.gateway.claimInvocation).toHaveBeenCalled());
    await flush();
    expect(taken.turns.run).not.toHaveBeenCalled();
    expect(taken.gateway.failInvocation).not.toHaveBeenCalled();
  });

  it("reports turn failures with their reason and never posts", async () => {
    const { runner, gateway, activity } = await harness({ turn: async () => { throw new TeamChatAgentTurnError("model_unavailable", "x"); } });
    runner.enqueue("inv-1", "agent");
    await vi.waitFor(() => expect(gateway.failInvocation).toHaveBeenCalledWith("inv-1", "model_unavailable", "lease-1"));
    expect(gateway.completeInvocation).not.toHaveBeenCalled();
    expect(activity.at(-1)?.[0]).toMatchObject({ state: "failed", reason: "model_unavailable" });
    const empty = await harness({ turn: async () => "   " });
    empty.runner.enqueue("inv-1", "agent");
    await vi.waitFor(() => expect(empty.gateway.failInvocation).toHaveBeenCalledWith("inv-1", "runtime_error", "lease-1"));
  });

  it("aborts a turn that outlives its lease and catches up pending requests", async () => {
    const { runner, gateway } = await harness({ turnTimeoutMs: 10, turn: (input) => new Promise((_, reject) => {
      input.signal.addEventListener("abort", () => reject(new TeamChatAgentTurnError("cancelled", "late")));
    }) });
    await runner.catchUp();
    await vi.waitFor(() => expect(gateway.failInvocation).toHaveBeenCalledWith("inv-1", "cancelled", "lease-1"));
    expect(gateway.pendingInvocations).toHaveBeenCalled();
  });

  it("leaves requests queued until the Workspace is registered, and retries transient claim failures", async () => {
    const waiting = await harness({ ready: false });
    waiting.runner.enqueue("inv-1", "agent");
    await flush();
    expect(waiting.gateway.claimInvocation).not.toHaveBeenCalled();
    waiting.turns.ready.mockReturnValue(true);
    waiting.runner.enqueue("inv-1", "agent");
    await vi.waitFor(() => expect(waiting.gateway.completeInvocation).toHaveBeenCalled());
    const flaky = await harness({ claimFails: "service_unavailable" });
    flaky.runner.enqueue("inv-1", "agent");
    await vi.waitFor(() => expect(flaky.gateway.claimInvocation).toHaveBeenCalledTimes(1));
    await flush();
    flaky.runner.enqueue("inv-1", "agent");
    await vi.waitFor(() => expect(flaky.gateway.claimInvocation).toHaveBeenCalledTimes(2));
  });
});

