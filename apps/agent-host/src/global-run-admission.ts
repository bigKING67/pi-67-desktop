import { createMessageId } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";

export type RunAdmissionState =
  | "accepted"
  | "running"
  | "waiting-approval"
  | "waiting-extension-input";

export interface RunAdmissionLease {
  readonly leaseId: string;
  readonly taskKey: string;
}

interface AdmissionRecord extends RunAdmissionLease {
  state: RunAdmissionState;
}

export class GlobalRunAdmission {
  private readonly records = new Map<string, AdmissionRecord>();

  constructor(private readonly maximum = 4) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new RangeError("maximum must be a positive integer.");
    }
  }

  reserve(taskKey: string): RunAdmissionLease {
    if (this.records.has(taskKey)) {
      throw new HostCommandError(
        "BUSY",
        "This Task already has a running Pi operation.",
        true
      );
    }
    if (this.records.size >= this.maximum) {
      throw new HostCommandError(
        "RESOURCE_LIMIT_EXCEEDED",
        "The application is already running the maximum number of Pi Tasks.",
        true,
        { maximumRunningTasks: this.maximum }
      );
    }
    const record: AdmissionRecord = {
      leaseId: createMessageId("run"),
      taskKey,
      state: "accepted"
    };
    this.records.set(taskKey, record);
    return { leaseId: record.leaseId, taskKey };
  }

  transition(taskKey: string, state: RunAdmissionState): boolean {
    const record = this.records.get(taskKey);
    if (!record) return false;
    record.state = state;
    return true;
  }

  release(lease: RunAdmissionLease): boolean {
    const record = this.records.get(lease.taskKey);
    if (!record || record.leaseId !== lease.leaseId) return false;
    this.records.delete(lease.taskKey);
    return true;
  }

  releaseTask(taskKey: string): boolean {
    return this.records.delete(taskKey);
  }

  stateFor(taskKey: string): RunAdmissionState | undefined {
    return this.records.get(taskKey)?.state;
  }

  snapshot(): Array<{ taskKey: string; state: RunAdmissionState }> {
    return [...this.records.values()].map(({ taskKey, state }) => ({ taskKey, state }));
  }
}
