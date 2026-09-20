import { Type, Value, type Static } from "./typebox-schema.js";

const strict = { additionalProperties: false };
export const LocalMemoryActivationRequestSchema = Type.Object({ enabled: Type.Boolean() }, strict);
export const LocalMemoryActivationSnapshotSchema = Type.Union([
  Type.Object({ available: Type.Literal(false) }, strict),
  Type.Object({ available: Type.Literal(true),
    preference: Type.Union([Type.Literal("enabled"), Type.Literal("disabled"), Type.Literal("unknown")]),
    selectedAtLaunch: Type.Boolean(), restartRequired: Type.Boolean(), busy: Type.Boolean(),
    lifecycle: Type.Union([Type.Literal("idle"), Type.Literal("starting"), Type.Literal("running"), Type.Literal("failed"),
      Type.Literal("blocked"), Type.Literal("stopping"), Type.Literal("stopped"), Type.Literal("stop-failed")]),
    issue: Type.Union([Type.Literal("none"), Type.Literal("storage"), Type.Literal("runtime-missing"),
      Type.Literal("models-missing"), Type.Literal("prerequisites"), Type.Literal("stop-failed")])
  }, strict)
]);
export type LocalMemoryActivationSnapshot = Static<typeof LocalMemoryActivationSnapshotSchema>;
export const LocalMemoryHealthCheckSchema = Type.Object({
  activation: LocalMemoryActivationSnapshotSchema,
  health: Type.Union([Type.Literal("healthy"), Type.Literal("unavailable"), Type.Literal("not-running")])
}, strict);
export type LocalMemoryHealthCheck = Static<typeof LocalMemoryHealthCheckSchema>;
export interface LocalMemoryActivationBridge {
  get(): Promise<LocalMemoryActivationSnapshot>;
  check(): Promise<LocalMemoryHealthCheck>;
  setEnabled(enabled: boolean): Promise<LocalMemoryActivationSnapshot>;
}
export function isLocalMemoryHealthCheck(value: unknown): value is LocalMemoryHealthCheck {
  return Value.Check(LocalMemoryHealthCheckSchema, value);
}
export function isLocalMemoryActivationSnapshot(value: unknown): value is LocalMemoryActivationSnapshot {
  return Value.Check(LocalMemoryActivationSnapshotSchema, value);
}
export function parseLocalMemoryActivationRequest(value: unknown): { enabled: boolean } | undefined {
  return Value.Check(LocalMemoryActivationRequestSchema, value) ? { enabled: value.enabled } : undefined;
}
