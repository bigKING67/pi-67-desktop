import { VERSION } from "@earendil-works/pi-coding-agent";
import type { DoctorReport, RuntimeIdentity, SessionCatalogStatus } from "@pi67/domain";
import type { AgentEvent, RuntimeDiagnostics } from "@pi67/protocol";
import { createDoctorReport } from "./runtime-doctor.js";
import { projectRuntimeDiagnostics, projectRuntimeIdentity } from "./runtime-metadata.js";
import type { RuntimeProjectionController } from "./runtime-projection-controller.js";
import type { RuntimeSessionBindings } from "./runtime-session-bindings.js";

export function collectPiRuntimeDiagnostics(
  bindings: RuntimeSessionBindings,
  projections: RuntimeProjectionController
): RuntimeDiagnostics {
  return projectRuntimeDiagnostics(
    bindings.runtime,
    bindings.extensions,
    VERSION,
    projections.getToolExecutionReceiptFailureCount()
  );
}

export async function runPiRuntimeDoctor(
  bindings: RuntimeSessionBindings,
  catalogStatus: SessionCatalogStatus,
  emit: (event: AgentEvent) => void
): Promise<DoctorReport> {
  const report = await createDoctorReport(
    bindings.settingsManager?.getShellPath(),
    process.env.PI67_CAPABILITY_PROBE_DIR,
    catalogStatus
  );
  emit({ type: "doctor.completed", payload: report });
  return report;
}

export function getPiRuntimeIdentity(bindings: RuntimeSessionBindings): RuntimeIdentity {
  return projectRuntimeIdentity(
    bindings.runtime,
    bindings.sessionGeneration,
    bindings.sessionFileIdentity
  );
}
