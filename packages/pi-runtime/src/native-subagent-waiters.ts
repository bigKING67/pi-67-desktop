import {
  MAX_NATIVE_SUBAGENT_WAIT_MS,
  isNativeSubagentTerminalState,
  type NativeSubagentView,
  type NativeSubagentWaitResult
} from "@pi67/domain";
import { cloneView, type ChildRecord } from "./native-subagent-support.js";

interface Waiter {
  ids: readonly string[];
  mode: "first" | "all";
  resolve: (result: NativeSubagentWaitResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NativeSubagentWaiters {
  readonly #waiters = new Set<Waiter>();

  wait(
    ids: readonly string[],
    mode: "first" | "all",
    timeoutMs: number,
    requireRecord: (id: string) => ChildRecord
  ): Promise<NativeSubagentWaitResult> {
    const boundedTimeout = Math.max(1_000, Math.min(timeoutMs, MAX_NATIVE_SUBAGENT_WAIT_MS));
    for (const id of ids) requireRecord(id);
    if (this.#satisfied(ids, mode, requireRecord)) {
      return Promise.resolve({ items: views(ids, requireRecord), timedOut: false });
    }
    return new Promise((resolve) => {
      const waiter: Waiter = {
        ids: [...ids],
        mode,
        resolve,
        timer: setTimeout(() => {
          this.#waiters.delete(waiter);
          resolve({ items: views(ids, requireRecord), timedOut: true });
        }, boundedTimeout)
      };
      this.#waiters.add(waiter);
    });
  }

  notify(requireRecord: (id: string) => ChildRecord): void {
    for (const waiter of this.#waiters) {
      if (!this.#satisfied(waiter.ids, waiter.mode, requireRecord)) continue;
      this.#waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve({ items: views(waiter.ids, requireRecord), timedOut: false });
    }
  }

  dispose(requireRecord: (id: string) => ChildRecord): void {
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ items: views(waiter.ids, requireRecord), timedOut: true });
    }
    this.#waiters.clear();
  }

  #satisfied(
    ids: readonly string[],
    mode: "first" | "all",
    requireRecord: (id: string) => ChildRecord
  ): boolean {
    const states = ids.map((id) => requireRecord(id).view.state);
    return mode === "first"
      ? states.some(isNativeSubagentTerminalState)
      : states.every(isNativeSubagentTerminalState);
  }
}

function views(ids: readonly string[], requireRecord: (id: string) => ChildRecord): NativeSubagentView[] {
  return ids.map((id) => cloneView(requireRecord(id).view));
}
