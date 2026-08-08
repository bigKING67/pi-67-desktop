import { CommandResultSchemas } from "./schemas.js";
import { SupportDiagnosticsExportRequestSchema } from "./runtime-diagnostics-schema.js";
import { Value } from "./typebox-schema.js";
import type {
  RuntimeDiagnostics,
  SupportDiagnosticsExportRequest
} from "./runtime-diagnostics-contract.js";

export function isRuntimeDiagnostics(value: unknown): value is RuntimeDiagnostics {
  return Value.Check(CommandResultSchemas["diagnostics.collect"], value);
}

export function isSupportDiagnosticsExportRequest(value: unknown): value is SupportDiagnosticsExportRequest {
  return Value.Check(SupportDiagnosticsExportRequestSchema, value);
}
