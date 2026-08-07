import { CommandResultSchemas } from "./schemas.js";
import { Value } from "./typebox-schema.js";
import type { RuntimeDiagnostics } from "./runtime-diagnostics-contract.js";

export function isRuntimeDiagnostics(value: unknown): value is RuntimeDiagnostics {
  return Value.Check(CommandResultSchemas["diagnostics.collect"], value);
}
