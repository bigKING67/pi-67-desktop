import type { AgentHostRuntimePoisonedMessage } from "@pi67/protocol";
import type { HostConnectionIdentity } from "./connection-context.js";
import { SessionWriterLeaseRegistry } from "./session-writer-lease-registry.js";

export function createHostSessionWriterLeaseRegistry(
  getHostIdentity: () => HostConnectionIdentity | undefined,
  onRuntimePoisoned?: (message: AgentHostRuntimePoisonedMessage) => void
): SessionWriterLeaseRegistry {
  return new SessionWriterLeaseRegistry({
    ...(process.env.PI67_STORAGE_ROOT === undefined
      ? {}
      : { storageRoot: process.env.PI67_STORAGE_ROOT }),
    getOwnerIdentity: () => ({
      appInstanceId: getHostIdentity()?.appInstanceId ?? "unbound-app",
      hostInstanceId: getHostIdentity()?.hostInstanceId ?? "unbound-host",
      hostEpoch: getHostIdentity()?.hostEpoch ?? 0,
      processId: process.pid
    }),
    onCompromised: () => onRuntimePoisoned?.({
      type: "agent-host-runtime-poisoned",
      code: "SESSION_WRITER_LEASE_COMPROMISED"
    })
  });
}
