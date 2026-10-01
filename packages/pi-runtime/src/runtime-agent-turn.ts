import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { RuntimeToolSafetyController } from "./runtime-tool-safety-controller.js";

/** Controls for one Team Chat Agent turn (ADR 0004): no tools, then the reply text. */
export interface RuntimeAgentTurnControls {
  /**
   * Call before `initialize` and again after it. Before, it selects the isolated
   * Agent resource profile (no context files, skills, prompt templates, third-party
   * extensions or Workspace path in the system prompt); after, it deactivates every
   * tool. Any tool call that still arrives is blocked.
   */
  disableAllTools(): void;
  lastAssistantText(): string | undefined;
}

export function createRuntimeAgentTurnControls(
  session: () => AgentSession,
  toolSafety: RuntimeToolSafetyController
): RuntimeAgentTurnControls {
  return {
    disableAllTools() {
      toolSafety.disableAllTools();
      let current: AgentSession;
      try {
        current = session();
      } catch {
        return;
      }
      current.setActiveToolsByName([]);
    },
    lastAssistantText() { return session().getLastAssistantText(); }
  };
}
