import { RuntimeError } from "@pi67/domain";

/** Transient Host policy, driven only by Main's native power notifications. */
export class EnterprisePowerEpoch {
  private generation = 0;
  private suspended = false;
  private cancellation = new AbortController();
  get signal(): AbortSignal { return this.cancellation.signal; }

  transition(state: "suspend" | "resume"): void {
    this.generation += 1;
    this.suspended = state === "suspend";
    const previous = this.cancellation;
    this.cancellation = new AbortController();
    if (this.suspended) this.cancellation.abort();
    previous.abort();
  }

  capture(): () => void {
    const generation = this.generation;
    const assertCurrent = () => {
      if (this.suspended || generation !== this.generation) {
        throw new RuntimeError("RUNTIME_NOT_READY", "Team authorization requires revalidation after a power transition.");
      }
    };
    assertCurrent();
    return assertCurrent;
  }
}

// One Main parent and one authority epoch per utility Host; never persisted as permission.
export const enterprisePowerEpoch = new EnterprisePowerEpoch();
