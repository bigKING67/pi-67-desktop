import type { ChildActivation, ChildRecord } from "./native-subagent-support.js";

export class NativeSubagentCleanup {
  readonly #pending = new Set<Promise<void>>();

  cleanup(record: ChildRecord, activation: ChildActivation, abort: boolean): Promise<void> {
    if (!activation.cleanup) {
      activation.cleanup = (async () => {
        if (abort && activation.handle.session.isStreaming) {
          await activation.handle.session.abort().catch(() => undefined);
        }
        try {
          activation.unsubscribe();
        } catch {
          // Pi subscriptions are best-effort during teardown; handle disposal remains authoritative.
        }
        await activation.handle.dispose().catch(() => undefined);
      })().finally(() => {
        if (record.active === activation) record.active = undefined;
      });
      this.#pending.add(activation.cleanup);
      void activation.cleanup.then(
        () => this.#pending.delete(activation.cleanup!),
        () => this.#pending.delete(activation.cleanup!)
      );
    } else if (abort && activation.handle.session.isStreaming) {
      void activation.handle.session.abort().catch(() => undefined);
    }
    return activation.cleanup;
  }

  async settle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all(this.#pending);
  }
}
