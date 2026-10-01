import type { TeamChatAgentInvocationReason, TeamSessionScope } from "@pi67/domain";
import type { TaskProtocolContext } from "@pi67/protocol";
import type { TaskRuntimeRegistry } from "../task-runtime-registry.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";

export interface TeamChatAgentTurnInput {
  invocationId: string;
  workspaceId: string;
  teamScope: TeamSessionScope;
  model: { provider: string; id: string };
  sessionName: string;
  prompt: string;
  signal: AbortSignal;
}

export interface TeamChatAgentTurns {
  /** Whether the bound Workspace is registered in this Host yet (the renderer registers it at startup). */
  ready(workspaceId: string): boolean;
  /** Runs one turn and returns the reply text; throws TeamChatAgentTurnError with a reason. */
  run(input: TeamChatAgentTurnInput): Promise<string>;
}

export class TeamChatAgentTurnError extends Error {
  constructor(readonly reason: Extract<TeamChatAgentInvocationReason, "not_configured" | "model_unavailable" | "runtime_error" | "cancelled">, message: string) {
    super(message);
    this.name = "TeamChatAgentTurnError";
  }
}

/**
 * Runs Agent turns as Host-internal Tasks (ADR 0004): a fresh team-scoped Session in
 * the bound Workspace, every tool disabled, the owner's chosen model. The Session
 * stays in the Workspace so the owner can review it; private memory never applies
 * because the Session is team-scoped.
 */
export function createTeamChatAgentTurns(workspaces: WorkspaceContextRegistry, tasks: TaskRuntimeRegistry): TeamChatAgentTurns {
  return {
    ready: (workspaceId) => workspaces.get(workspaceId) !== undefined,
    async run(input) {
      const workspace = workspaces.get(input.workspaceId);
      if (!workspace) throw new TeamChatAgentTurnError("not_configured", "The Agent's Workspace is not open on this Desktop.");
      const context: TaskProtocolContext = {
        scope: "task",
        workspaceId: input.workspaceId,
        taskId: `chat-agent-${input.invocationId}`,
        taskGeneration: 1
      };
      const runtime = await tasks.load(context, workspace.workspaceServices);
      const abort = () => { void runtime.abort().catch(() => undefined); };
      try {
        const turn = runtime.agentTurn;
        if (!turn) throw new TeamChatAgentTurnError("not_configured", "This runtime cannot run Agent turns.");
        // Before initialize: the Session loads the isolated Agent profile (no owner context).
        turn.disableAllTools();
        await step("not_configured", () => runtime.initialize({
          ...workspace.initialization,
          creationId: context.taskId,
          teamScope: input.teamScope
        }));
        turn.disableAllTools();
        await step("model_unavailable", () => runtime.selectModel(input.model.provider, input.model.id));
        await runtime.setSessionName(input.sessionName);
        if (input.signal.aborted) throw new TeamChatAgentTurnError("cancelled", "The request was cancelled.");
        input.signal.addEventListener("abort", abort, { once: true });
        await step("runtime_error", () => runtime.submitPrompt(input.prompt, undefined, input.signal));
        if (input.signal.aborted) throw new TeamChatAgentTurnError("cancelled", "The Agent ran out of time.");
        const text = turn.lastAssistantText()?.trim();
        if (!text) throw new TeamChatAgentTurnError("runtime_error", "The model returned no reply.");
        return text;
      } finally {
        input.signal.removeEventListener("abort", abort);
        await tasks.disposeTask(context).catch(() => undefined);
        tasks.forget(context);
      }
    }
  };
}

async function step<T>(reason: TeamChatAgentTurnError["reason"], action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof TeamChatAgentTurnError) throw error;
    throw new TeamChatAgentTurnError(reason, error instanceof Error ? error.message : String(error));
  }
}
