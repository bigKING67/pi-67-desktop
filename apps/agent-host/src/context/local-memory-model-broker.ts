import { resolveLocalMemoryExtractionModel, type PiConfigurationService } from "@pi67/pi-runtime";
import { isLocalMemoryModelRequest, isLocalMemoryModelCancel, isLocalMemoryModelResult,
  type LocalMemoryModelResult } from "@pi67/protocol";

/** Only the utility parent channel calls this; it is not a Renderer router. */
export class LocalMemoryModelBroker {
  #active: { requestId: string; controller: AbortController } | undefined;
  #stopped = false;
  constructor(private readonly configuration: Pick<PiConfigurationService, "createModelRuntime">) {}

  handleMessage(message: unknown, reply: (result: LocalMemoryModelResult) => void): boolean {
    if (isLocalMemoryModelCancel(message)) {
      if (this.#active?.requestId === message.requestId) this.#active.controller.abort();
      return true;
    }
    if (!isLocalMemoryModelRequest(message)) return false;
    if (this.#stopped) return true;
    const send = (result: LocalMemoryModelResult) => {
      try { reply(result); } catch { /* Parent port can close; never log a secret-bearing result. */ }
    };
    if (this.#active) {
      send({ type: "local-memory-extraction-result", requestId: message.requestId, ok: false, errorCode: "BUSY" });
      return true;
    }
    const active = { requestId: message.requestId, controller: new AbortController() };
    this.#active = active;
    const signal = AbortSignal.any([active.controller.signal, AbortSignal.timeout(15_000)]);
    void resolveLocalMemoryExtractionModel(this.configuration, message.selection, signal).then((model) => {
      const result = { type: "local-memory-extraction-result" as const, requestId: message.requestId, ok: true as const, model };
      if (!isLocalMemoryModelResult(result)) throw new Error("Invalid private model result.");
      if (this.#active === active && !this.#stopped && !signal.aborted) send(result);
    }).catch(() => {
      if (this.#active === active && !this.#stopped && !active.controller.signal.aborted) {
        send({ type: "local-memory-extraction-result", requestId: message.requestId, ok: false, errorCode: "UNAVAILABLE" });
      }
    }).finally(() => { if (this.#active === active) this.#active = undefined; });
    return true;
  }

  shutdown(): void { this.#stopped = true; this.#active?.controller.abort(); this.#active = undefined; }
}
