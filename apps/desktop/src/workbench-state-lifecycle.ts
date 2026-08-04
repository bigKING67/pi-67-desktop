export type TaskLifecycle =
  | "draft"
  | "initializing"
  | "idle"
  | "accepted"
  | "running"
  | "waiting-approval"
  | "waiting-extension-input"
  | "completed"
  | "failed"
  | "cancelled"
  | "lost"
  | "stopped";

export function isTaskLifecycle(value: unknown): value is TaskLifecycle {
  return value === "draft"
    || value === "initializing"
    || value === "idle"
    || value === "accepted"
    || value === "running"
    || value === "waiting-approval"
    || value === "waiting-extension-input"
    || value === "completed"
    || value === "failed"
    || value === "cancelled"
    || value === "lost"
    || value === "stopped";
}
