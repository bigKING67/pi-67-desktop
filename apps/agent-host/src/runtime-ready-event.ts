import type { SessionSnapshot } from "@pi67/domain";
import type { AgentRuntime } from "@pi67/pi-runtime";
import type { AgentEvent } from "@pi67/protocol";

export function runtimeReadyEvent(
  runtime: AgentRuntime,
  snapshot: SessionSnapshot
): Extract<AgentEvent, { type: "runtime.ready" }> {
  return {
    type: "runtime.ready",
    payload: {
      capabilities: {
        sdkVersion: runtime.getSdkVersion(),
        supportsFollowUp: true,
        supportsSessionTree: true,
        extensionUi: runtime.getExtensionUiCapabilities()
      },
      snapshot
    }
  };
}
