import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { sharedHistoryNeedsAuthorization } from "./session-memory-provenance.js";
import { authorizeTeamHistory, type TeamHistoryAccess } from "./team-history-authorization.js";
import { streamWithTeamLease } from "./team-model-stream.js";
import { createTeamToolExecutionGuard } from "./team-tool-execution.js";
import { createTeamToolLease, type TeamToolLease } from "./team-tool-lease.js";

const bound = new WeakSet<AgentSession>();

/** Preserve Pi's loop and transport; reject unverified shared history before transport starts. */
export function bindSharedHistoryModelGuard(session: AgentSession, access?: TeamHistoryAccess): void {
  if (bound.has(session)) return;
  const transport = session.agent.streamFunction;
  const beforeToolCall = session.agent.beforeToolCall?.bind(session.agent);
  let toolLease: TeamToolLease | undefined;
  let toolRunSignal: AbortSignal | undefined;
  const guardExecution = createTeamToolExecutionGuard(() => {
    if (toolLease) return toolLease;
    if (sharedHistoryNeedsAuthorization(session.sessionManager)) throw new Error("Team Tool execution requires a currently authorized model request.");
    return undefined;
  });
  session.agent.beforeToolCall = async (context, signal) => {
    if (!sharedHistoryNeedsAuthorization(session.sessionManager)) return beforeToolCall?.(context, signal);
    const assertCurrent = () => {
      signal?.throwIfAborted();
      if (!toolLease) throw new Error("Team Tool admission requires a currently authorized model request.");
      toolLease.assertValid();
    };
    let release: (() => void) | undefined;
    try {
      assertCurrent();
      release = toolLease?.retain();
      const result = await beforeToolCall?.(context, signal);
      assertCurrent();
      const tool = context.context.tools?.find((candidate) => candidate.name === context.toolCall.name);
      if (tool && !result?.block) guardExecution(tool);
      return result;
    } catch (error) {
      return { block: true, terminate: true, reason: error instanceof Error ? error.message : "Team Tool admission failed." };
    } finally {
      release?.();
    }
  };
  session.agent.streamFunction = async (...args) => {
    if (toolLease && toolRunSignal === args[2]?.signal) toolLease.assertValid();
    toolLease = undefined;
    toolRunSignal = args[2]?.signal;
    if (sharedHistoryNeedsAuthorization(session.sessionManager)) {
      if (!access) throw new Error("Shared history requires verified team Session authorization before model processing. Start a new private Session for private work.");
      const manager = session.sessionManager, sessionId = manager.getSessionId();
      const model = { baseUrl: args[0].baseUrl, id: args[0].id };
      let lease = await authorizeTeamHistory(manager, model, access, args[2]?.signal);
      const assertCurrent = () => {
        if (session.sessionManager !== manager || manager.getSessionId() !== sessionId) throw new Error("Team Session changed during the model request.");
        lease.assertValid();
      };
      const requestSignal = args[2]?.signal;
      const assertToolAdmission = () => {
        if (!requestSignal || requestSignal !== session.agent.signal) throw new Error("Team Tool admission belongs to a different Agent run.");
        requestSignal.throwIfAborted();
        assertCurrent();
      };
      toolLease = createTeamToolLease(assertToolAdmission, async (signal) => {
        const refreshed = await lease.renewToolBasis(signal);
        signal.throwIfAborted();
        assertToolAdmission();
        lease = refreshed;
      }, requestSignal);
      return streamWithTeamLease(transport, args, assertCurrent, async (signal) => {
        const refreshed = await authorizeTeamHistory(manager, model, access, signal);
        signal.throwIfAborted();
        lease.assertValid();
        lease = refreshed;
      });
    }
    return transport(...args);
  };
  bound.add(session);
}
