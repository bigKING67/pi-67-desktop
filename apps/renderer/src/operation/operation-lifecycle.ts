import type { OperationLifecycle } from "@pi67/domain";

export function isActiveOperationLifecycle(lifecycle: OperationLifecycle): boolean {
  return lifecycle === "submitting"
    || lifecycle === "accepted"
    || lifecycle === "running"
    || lifecycle === "waiting-input";
}
