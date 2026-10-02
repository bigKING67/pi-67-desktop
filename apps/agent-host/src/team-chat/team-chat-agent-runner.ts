import type { TeamChatAgentActivity } from "@pi67/domain";
import type { TeamChatAgentBindingStore } from "./team-chat-agent-bindings.js";
import { TeamChatAgentGateway, type TeamChatAgentClaim, type TeamChatAgentFailure } from "./team-chat-agent-gateway.js";
import { teamChatAgentPrompt, teamChatAgentReply } from "./team-chat-agent-prompt.js";
import { TeamChatAgentTurnError, type TeamChatAgentTurns } from "./team-chat-agent-turns.js";
import type { TeamChatAccess } from "./team-chat-gateway.js";

/** Finish within the service's 180-second lease, leaving time to post the reply. */
const TURN_TIMEOUT_MS = 150_000;
const MAX_ACTIVITY = 20;
const MAX_QUEUED = 50;
/** Also re-offered by a periodic catch-up, for requests left while the Workspace was not ready. */
const CATCH_UP_INTERVAL_MS = 30_000;

export interface TeamChatAgentRunnerDependencies {
  access(): Promise<TeamChatAccess>;
  bindings: TeamChatAgentBindingStore;
  turns: TeamChatAgentTurns | undefined;
  onActivity(activity: readonly TeamChatAgentActivity[]): void;
  gateway?: (access: TeamChatAccess) => TeamChatAgentGateway;
  turnTimeoutMs?: number;
}

/**
 * Runs this Desktop's Agent requests one at a time (ADR 0004). Requests for Agents
 * this Desktop does not host are left for the owner's other Desktops; a request
 * another Desktop already claimed simply fails to claim here.
 */
export class TeamChatAgentRunner {
  readonly #queue: Array<{ invocationId: string; agentUserId: string }> = [];
  readonly #known = new Set<string>();
  #activity: TeamChatAgentActivity[] = [];
  #draining = false;
  #stopped = new AbortController();
  #poll: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly dependencies: TeamChatAgentRunnerDependencies) {}

  /** Re-checks pending requests periodically while this Desktop hosts Agents. */
  startPolling(): void {
    if (this.#poll || this.#stopped.signal.aborted) return;
    this.#poll = setInterval(() => {
      void this.dependencies.bindings.hasEnabled().then((hosting) => hosting ? this.catchUp() : undefined).catch(() => undefined);
    }, CATCH_UP_INTERVAL_MS);
    this.#poll.unref?.();
  }

  get activity(): readonly TeamChatAgentActivity[] { return this.#activity; }

  enqueue(invocationId: string, agentUserId: string): void {
    if (this.#known.has(invocationId) || this.#queue.length >= MAX_QUEUED || this.#stopped.signal.aborted) return;
    this.#known.add(invocationId);
    this.#queue.push({ invocationId, agentUserId });
    void this.#drain();
  }

  /** After each (re)connect: pick up requests that arrived while this Desktop was away. */
  async catchUp(): Promise<void> {
    if (!this.dependencies.turns) return;
    const access = await this.dependencies.access();
    if ((await this.dependencies.bindings.enabledAgentIds(access.teamId)).length === 0) return;
    for (const invocation of await this.#gateway(access).pendingInvocations()) {
      this.enqueue(invocation.id, invocation.agentUserId);
    }
  }

  stop(): void {
    this.#stopped.abort();
    clearInterval(this.#poll);
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      for (let next = this.#queue.shift(); next; next = this.#queue.shift()) {
        if (this.#stopped.signal.aborted) return;
        // Anything thrown before a claim leaves the request for a later catch-up.
        await this.#process(next.invocationId, next.agentUserId).catch(() => { this.#known.delete(next.invocationId); });
      }
    } finally {
      this.#draining = false;
    }
  }

  async #process(invocationId: string, agentUserId: string): Promise<void> {
    const { turns, bindings } = this.dependencies;
    if (!turns) return;
    const access = await this.dependencies.access();
    const binding = await bindings.find(access.teamId, agentUserId);
    if (!binding?.enabled || !turns.ready(binding.workspaceId)) {
      // Not hosted here, or the Workspace is not registered yet: leave it queued for a later catch-up.
      this.#known.delete(invocationId);
      return;
    }
    const gateway = this.#gateway(access);
    let claim: TeamChatAgentClaim;
    try {
      claim = await gateway.claimInvocation(invocationId);
    } catch (error) {
      // Taken elsewhere or no longer waiting: done. Anything else (network, 5xx) may be retried.
      if (serviceError(error) !== "chat_agent_invocation_unavailable") this.#known.delete(invocationId);
      return;
    }
    this.#record({ agentUserId, invocationId, state: "running", at: Date.now() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.dependencies.turnTimeoutMs ?? TURN_TIMEOUT_MS);
    timer.unref?.();
    const stop = () => controller.abort();
    this.#stopped.signal.addEventListener("abort", stop, { once: true });
    try {
      const [members, agents, bots] = await Promise.all([gateway.listMembers(), gateway.listAgents(), gateway.listBots().catch(() => [])]);
      const agent = agents.find((item) => item.userId === agentUserId);
      if (!agent || agent.ownerUserId !== access.userId) throw new TeamChatAgentTurnError("not_configured", "Agent unavailable.");
      // Webhook text comes from outside the team; the model sees it labelled as such.
      const people = [...members, ...agents.map((item) => ({ userId: item.userId, displayName: item.name })),
        ...bots.map((item) => ({ userId: item.userId, displayName: `${item.name}（Bot，外部集成）` }))];
      const name = (userId: string) => people.find((person) => person.userId === userId)?.displayName ?? "同事";
      const conversationLabel = claim.conversationKind === "channel"
        ? `#${claim.conversationName ?? ""}`
        : `与 ${name(claim.invocation.invokerUserId)} 的私信`;
      const prompt = teamChatAgentPrompt({
        agentName: agent.name,
        agentDescription: agent.description,
        ownerName: name(access.userId),
        conversationLabel,
        invokerName: name(claim.invocation.invokerUserId),
        messages: claim.messages.map((message) => ({
          senderName: name(message.senderUserId),
          body: message.body,
          createdAt: message.createdAt,
          fromAgent: message.senderUserId === agentUserId
        }))
      });
      const text = await turns.run({
        invocationId,
        workspaceId: binding.workspaceId,
        teamScope: { teamId: access.teamId, projectId: binding.projectId },
        model: binding.model,
        sessionName: `Agent · ${agent.name} · ${conversationLabel}`,
        prompt,
        signal: controller.signal
      });
      const body = teamChatAgentReply(text);
      if (!body) throw new TeamChatAgentTurnError("runtime_error", "Empty reply.");
      await gateway.completeInvocation(invocationId, { clientKey: `agent-${invocationId}`, body, leaseToken: claim.leaseToken });
      this.#record({ agentUserId, invocationId, state: "replied", at: Date.now() });
    } catch (error) {
      const reason: TeamChatAgentFailure = error instanceof TeamChatAgentTurnError ? error.reason : "runtime_error";
      await gateway.failInvocation(invocationId, reason, claim.leaseToken).catch(() => undefined);
      this.#record({ agentUserId, invocationId, state: "failed", reason, at: Date.now() });
    } finally {
      clearTimeout(timer);
      this.#stopped.signal.removeEventListener("abort", stop);
    }
  }

  #gateway(access: TeamChatAccess): TeamChatAgentGateway {
    return this.dependencies.gateway?.(access) ?? new TeamChatAgentGateway(access);
  }

  #record(activity: TeamChatAgentActivity): void {
    this.#activity = [activity, ...this.#activity.filter((item) => item.invocationId !== activity.invocationId)].slice(0, MAX_ACTIVITY);
    this.dependencies.onActivity(this.#activity);
  }
}

function serviceError(error: unknown): string | undefined {
  const details = typeof error === "object" && error !== null && "details" in error
    ? (error as { details?: { serviceError?: unknown } }).details
    : undefined;
  return typeof details?.serviceError === "string" ? details.serviceError : undefined;
}
