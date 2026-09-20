import { Type, Value, type Static } from "./typebox-schema.js";
export const TEAM_WORKER_PREPARATION_TIMEOUT_MS = 60_000;
export const TEAM_WORKER_HANDOFF_TIMEOUT_MS = 5_000;
const requestId = Type.String({ format: "uuid", minLength: 36, maxLength: 36 });
const failureStage = Type.Union([
  Type.Literal("preparation"), Type.Literal("launch-or-cleanup"), Type.Literal("worker-exit"),
  Type.Literal("runtime"), Type.Literal("input"), Type.Literal("storage-init"),
  Type.Literal("vector-index"), Type.Literal("storage-close"), Type.Literal("result-receipt")
]);
export const TeamWorkerRequestSchema = Type.Object({
  type: Type.Union([Type.Literal("team-worker-start"), Type.Literal("team-worker-cancel")]), requestId
}, { additionalProperties: false });
export const TeamWorkerStateSchema = Type.Object({
  type: Type.Literal("team-worker-state"), requestId,
  state: Type.Union([Type.Literal("prepared"), Type.Literal("started"), Type.Literal("completed"), Type.Literal("cancelled"), Type.Literal("failed")]),
  failureStage: Type.Optional(failureStage)
}, { additionalProperties: false });
export type TeamWorkerRequest = Static<typeof TeamWorkerRequestSchema>;
export type TeamWorkerState = Static<typeof TeamWorkerStateSchema>;
export function isTeamWorkerRequest(value: unknown): value is TeamWorkerRequest { return Value.Check(TeamWorkerRequestSchema, value); }
export function isTeamWorkerState(value: unknown): value is TeamWorkerState {
  return Value.Check(TeamWorkerStateSchema, value) && (value.failureStage === undefined || value.state === "failed");
}
/** Fixed native ABI; unknown/legacy exits never imply success or expose raw errors. */
export function teamWorkerExitStage(code: number | null): NonNullable<TeamWorkerState["failureStage"]> {
  switch (code) {
    case 71: return "runtime";
    case 72: return "input";
    case 73: return "storage-init";
    case 74: return "vector-index";
    case 75: return "storage-close";
    case 76: return "result-receipt";
    default: return "worker-exit";
  }
}
