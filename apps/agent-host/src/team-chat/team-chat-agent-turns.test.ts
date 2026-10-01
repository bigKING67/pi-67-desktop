import { describe, expect, it, vi } from "vitest";
import type { TaskRuntimeRegistry } from "../task-runtime-registry.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";
import { createTeamChatAgentTurns, TeamChatAgentTurnError } from "./team-chat-agent-turns.js";

function setup(overrides: Record<string, unknown> = {}, workspaceKnown = true) {
  const calls: string[] = [];
  const runtime = {
    initialize: vi.fn(async (options: unknown) => { calls.push(`initialize:${JSON.stringify(options)}`); }),
    selectModel: vi.fn(async (provider: string, id: string) => { calls.push(`model:${provider}/${id}`); }),
    setSessionName: vi.fn(async (name: string) => { calls.push(`name:${name}`); }),
    submitPrompt: vi.fn(async () => { calls.push("prompt"); }),
    abort: vi.fn(async () => undefined),
    agentTurn: { disableAllTools: vi.fn(() => { calls.push("no-tools"); }), lastAssistantText: vi.fn(() => " 回复 ") },
    ...overrides
  };
  const tasks = { load: vi.fn(async () => runtime), disposeTask: vi.fn(async () => true), forget: vi.fn() };
  const workspaces = { get: vi.fn(() => workspaceKnown ? { workspaceServices: {}, initialization: { cwd: "/w", trust: "trusted" } } : undefined) };
  const turns = createTeamChatAgentTurns(workspaces as unknown as WorkspaceContextRegistry, tasks as unknown as TaskRuntimeRegistry);
  const input = { invocationId: "inv-1", workspaceId: "w1", teamScope: { teamId: "t1", projectId: "p1" },
    model: { provider: "anthropic", id: "claude" }, sessionName: "Agent · 研究助手", prompt: "问题", signal: new AbortController().signal };
  return { turns, tasks, runtime, calls, input };
}

describe("team chat agent turns", () => {
  it("creates a team-scoped Session, removes every tool before the model runs, and disposes the Task", async () => {
    const { turns, tasks, calls, input } = setup();
    await expect(turns.run(input)).resolves.toBe("回复");
    expect(calls).toEqual([
      "no-tools",
      'initialize:{"cwd":"/w","trust":"trusted","creationId":"chat-agent-inv-1","teamScope":{"teamId":"t1","projectId":"p1"}}',
      "no-tools", "model:anthropic/claude", "name:Agent · 研究助手", "prompt"
    ]);
    expect(tasks.disposeTask).toHaveBeenCalledWith({ scope: "task", workspaceId: "w1", taskId: "chat-agent-inv-1", taskGeneration: 1 });
    expect(tasks.forget).toHaveBeenCalledWith({ scope: "task", workspaceId: "w1", taskId: "chat-agent-inv-1", taskGeneration: 1 });
    expect(turns.ready("w1")).toBe(true);
  });

  it("maps failures to request reasons", async () => {
    const reason = (promise: Promise<unknown>) => promise.then(() => "ok", (error: TeamChatAgentTurnError) => error.reason);
    expect(await reason(setup({}, false).turns.run(setup().input))).toBe("not_configured");
    const unauthorized = setup({ initialize: vi.fn(async () => { throw new Error("project access revoked"); }) });
    expect(await reason(unauthorized.turns.run(unauthorized.input))).toBe("not_configured");
    const model = setup({ selectModel: vi.fn(async () => { throw new Error("unknown model"); }) });
    expect(await reason(model.turns.run(model.input))).toBe("model_unavailable");
    const empty = setup({ agentTurn: { disableAllTools: vi.fn(), lastAssistantText: vi.fn(() => undefined) } });
    expect(await reason(empty.turns.run(empty.input))).toBe("runtime_error");
    expect(empty.tasks.disposeTask).toHaveBeenCalled();
  });

  it("aborts the runtime when the request times out", async () => {
    const controller = new AbortController();
    const { turns, runtime, input } = setup({ submitPrompt: vi.fn(async () => { controller.abort(); }) });
    await expect(turns.run({ ...input, signal: controller.signal })).rejects.toMatchObject({ reason: "cancelled" });
    expect(runtime.abort).toHaveBeenCalled();
  });
});
