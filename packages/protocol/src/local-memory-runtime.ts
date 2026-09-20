import { Type, type Static } from "./typebox-schema.js";

export const LocalMemoryRuntimeStatusSchema = Type.Union([
  Type.Literal("missing"), Type.Literal("present"), Type.Literal("unavailable")
]);
export const LocalMemoryRuntimeInstallResultSchema = Type.Union([
  Type.Literal("installed"), Type.Literal("cancelled"), Type.Literal("failed"),
  Type.Literal("busy"), Type.Literal("unavailable")
]);
export type LocalMemoryRuntimeStatus = Static<typeof LocalMemoryRuntimeStatusSchema>;
export type LocalMemoryRuntimeInstallResult = Static<typeof LocalMemoryRuntimeInstallResultSchema>;
export type LocalMemoryRuntimePurpose = "private" | "team-index-v1" | "team-query-v1";
export interface LocalMemoryRuntimeBridge {
  getStatus(purpose?: LocalMemoryRuntimePurpose): Promise<LocalMemoryRuntimeStatus>;
  install(purpose?: LocalMemoryRuntimePurpose): Promise<LocalMemoryRuntimeInstallResult>;
  cancel(): Promise<void>;
}
