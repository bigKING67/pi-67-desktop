import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TeamToolLease } from "./team-tool-lease.js";

/** Wrap the exact Pi Tool object retained by preparation, without rescheduling it. */
export function createTeamToolExecutionGuard(acquire: () => TeamToolLease | undefined) {
  const wrapped = new WeakMap<AgentTool, AgentTool["execute"]>();
  return (tool: AgentTool) => {
    if (wrapped.get(tool) === tool.execute) return;
    const execute = tool.execute.bind(tool);
    const guarded: AgentTool["execute"] = async (id, args, signal, onUpdate) => {
      const lease = acquire();
      if (!lease) return execute(id, args, signal, onUpdate);
      signal?.throwIfAborted();
      const release = lease.retain();
      const controller = new AbortController();
      let invalid = false;
      const cancel = () => { invalid = true; controller.abort(); };
      const check = () => {
        if (invalid) return false;
        try { signal?.throwIfAborted(); lease.assertValid(); return true; }
        catch { cancel(); return false; }
      };
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = setInterval(check, 1_000);
      timer.unref?.();
      try {
        // Keep Pi pending until the underlying Tool actually settles, even if it ignores abort.
        const result = await execute(id, args, controller.signal, onUpdate ? (partial) => {
          if (check()) onUpdate(partial);
        } : undefined);
        if (!check()) throw new Error("Team Tool authorization ended or execution was cancelled; prior side effects may remain.");
        return result;
      } finally {
        clearInterval(timer);
        signal?.removeEventListener("abort", cancel);
        release();
      }
    };
    tool.execute = guarded;
    wrapped.set(tool, guarded);
  };
}
