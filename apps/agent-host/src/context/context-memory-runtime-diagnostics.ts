import type { ContextMemoryConfiguration, ContextRuntimeStatus } from "@pi67/domain";
import type { CommandResults } from "@pi67/protocol";
import { contextStatusResult } from "./context-memory-support.js";
import {
  inspectMemoryOwnerRuntime,
  memoryOwnerConflictDetail,
  memoryOwnerDiagnosticChecks,
  type MemoryOwnerRuntimeInspection
} from "./memory-conflict-detector.js";
import { OpenVikingClient } from "./openviking-client.js";

export async function readContextRuntimeStatus(
  configuration: ContextMemoryConfiguration,
  agentDir: string,
  ownerInspection?: MemoryOwnerRuntimeInspection
): Promise<ContextRuntimeStatus> {
  const inspection = ownerInspection ?? await inspectMemoryOwnerRuntime(agentDir);
  const conflicts = inspection.state === "conflict" ? inspection.blockedOwners : [];
  if (!configuration.enabled) return contextStatusResult(configuration, conflicts, "disabled");
  if (conflicts.length > 0) {
    return {
      ...contextStatusResult(configuration, conflicts, "conflict"),
      detail: memoryOwnerConflictDetail(inspection)!
    };
  }
  try {
    const health = await new OpenVikingClient(configuration).health();
    return {
      ...contextStatusResult(configuration, conflicts, "healthy"),
      ...(health.version === undefined ? {} : { version: health.version }),
      latencyMs: health.latencyMs
    };
  } catch (error) {
    return {
      ...contextStatusResult(configuration, conflicts, "unavailable"),
      detail: error instanceof Error ? error.message : "OpenViking is unavailable."
    };
  }
}

export async function readContextRuntimeDoctor(
  configuration: ContextMemoryConfiguration,
  agentDir: string,
  probeRemote: boolean
): Promise<CommandResults["context.runtime.doctor"]> {
  const inspection = await inspectMemoryOwnerRuntime(agentDir);
  const status = probeRemote
    ? await readContextRuntimeStatus(configuration, agentDir, inspection)
    : contextStatusResult(
        configuration,
        inspection.state === "conflict" ? inspection.blockedOwners : [],
        "degraded"
      );
  return {
    checkedAt: Date.now(),
    status,
    effectiveConfiguration: configuration,
    checks: [
      {
        id: "effective-config",
        status: "pass",
        detail: "Loaded the effective configuration; actor-only recall is enabled and Tool-result capture is disabled."
      },
      ...memoryOwnerDiagnosticChecks(inspection),
      {
        id: "openviking-health",
        status: status.health === "healthy"
          ? "pass"
          : status.health === "degraded" ? "warn" : "fail",
        detail: probeRemote
          ? (status.detail ?? `OpenViking health is ${status.health}.`)
          : "Remote health probe was skipped."
      }
    ]
  };
}
