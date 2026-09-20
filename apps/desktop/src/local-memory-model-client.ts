import { randomUUID } from "node:crypto";
import type { UtilityProcess } from "electron";
import { isLocalMemoryModelRequest, isLocalMemoryModelResult,
  type LocalMemoryModelRequest, type LocalMemoryResolvedModel } from "@pi67/protocol";

/** Main-only client, bound to one current Host and one in-flight resolution. */
export class LocalMemoryModelClient {
  #pending = false;
  constructor(private readonly currentHost: () => UtilityProcess | undefined) {}

  resolve(selection: LocalMemoryModelRequest["selection"], signal: AbortSignal): Promise<LocalMemoryResolvedModel> {
    signal.throwIfAborted();
    const host = this.currentHost();
    const request = { type: "local-memory-extraction-resolve" as const, requestId: randomUUID(), selection };
    if (!host || this.#pending || !isLocalMemoryModelRequest(request)) return Promise.reject(new Error("Memory model broker is unavailable."));
    this.#pending = true;
    return new Promise<LocalMemoryResolvedModel>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer); signal.removeEventListener("abort", abort);
        host.removeListener("message", message); host.removeListener("exit", exit);
        this.#pending = false;
      };
      const fail = () => { cleanup(); reject(new Error("Memory extraction configuration is unavailable.")); };
      const cancel = () => {
        try { host.postMessage({ type: "local-memory-extraction-cancel", requestId: request.requestId }); }
        catch { /* Closing parent port; never log private messages. */ }
      };
      const abort = () => { cancel(); fail(); };
      const exit = () => fail();
      const message = (value: unknown) => {
        if (!isLocalMemoryModelResult(value) || value.requestId !== request.requestId) return;
        if (this.currentHost() !== host || !value.ok || value.model.model !== selection.model) { fail(); return; }
        cleanup(); resolve(value.model);
      };
      const timer = setTimeout(abort, 20_000); timer.unref?.();
      host.on("message", message); host.once("exit", exit);
      signal.addEventListener("abort", abort, { once: true });
      try { host.postMessage(request); } catch { fail(); }
    });
  }
}
