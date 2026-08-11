import {
  MAX_NATIVE_SUBAGENT_LIVE_GLOBAL,
  MAX_NATIVE_SUBAGENT_LIVE_PER_PARENT,
  MAX_NATIVE_SUBAGENT_SPAWN_BATCH,
  RuntimeError
} from "@pi67/domain";

export interface NativeSubagentAdmissionLease {
  parentKey: string;
  runId: string;
  activationId: string;
}

/** Process-owned child admission. It is deliberately separate from top-level Task admission. */
export class NativeSubagentAdmission {
  private readonly leases = new Map<string, NativeSubagentAdmissionLease>();
  private readonly parentCounts = new Map<string, number>();

  assertBatchSize(size: number): void {
    if (!Number.isInteger(size) || size < 1 || size > MAX_NATIVE_SUBAGENT_SPAWN_BATCH) {
      throw new RuntimeError(
        "RESOURCE_LIMIT_EXCEEDED",
        `A native subagent spawn batch must contain 1-${MAX_NATIVE_SUBAGENT_SPAWN_BATCH} children.`
      );
    }
  }

  acquire(lease: NativeSubagentAdmissionLease): NativeSubagentAdmissionLease {
    const key = leaseKey(lease);
    const existing = this.leases.get(key);
    if (existing) return existing;
    if (this.leases.size >= MAX_NATIVE_SUBAGENT_LIVE_GLOBAL) {
      throw new RuntimeError(
        "RESOURCE_LIMIT_EXCEEDED",
        `Pi-67 already has ${MAX_NATIVE_SUBAGENT_LIVE_GLOBAL} live native subagents.`
      );
    }
    const parentCount = this.parentCounts.get(lease.parentKey) ?? 0;
    if (parentCount >= MAX_NATIVE_SUBAGENT_LIVE_PER_PARENT) {
      throw new RuntimeError(
        "RESOURCE_LIMIT_EXCEEDED",
        `This parent Task already has ${MAX_NATIVE_SUBAGENT_LIVE_PER_PARENT} live native subagents.`
      );
    }
    this.leases.set(key, { ...lease });
    this.parentCounts.set(lease.parentKey, parentCount + 1);
    return { ...lease };
  }

  release(lease: NativeSubagentAdmissionLease): boolean {
    const key = leaseKey(lease);
    const current = this.leases.get(key);
    if (!current) return false;
    this.leases.delete(key);
    const parentCount = this.parentCounts.get(current.parentKey) ?? 0;
    if (parentCount <= 1) this.parentCounts.delete(current.parentKey);
    else this.parentCounts.set(current.parentKey, parentCount - 1);
    return true;
  }

  snapshot(): { global: number; parents: ReadonlyMap<string, number> } {
    return { global: this.leases.size, parents: new Map(this.parentCounts) };
  }
}

function leaseKey(lease: NativeSubagentAdmissionLease): string {
  return JSON.stringify([lease.parentKey, lease.runId, lease.activationId]);
}
