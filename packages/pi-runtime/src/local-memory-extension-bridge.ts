import { createEventBus } from "@earendil-works/pi-coding-agent";
import type { LocalMemoryConnection } from "@pi67/protocol";

export interface LocalMemoryAccess { connect(): Promise<LocalMemoryConnection>; }

/** One Pi ResourceLoader bus per session-services instance; never a renderer channel. */
export function createLocalMemoryEventBus(access?: LocalMemoryAccess) {
  const bus = createEventBus();
  if (!access) return bus;
  bus.on("pi67:managed-private-memory:connect", (data) => {
    if (!data || typeof data !== "object" || !("accept" in data) || typeof data.accept !== "function") return;
    data.accept(Promise.resolve().then(() => access.connect()).catch(() => {
      throw new Error("Managed local memory is unavailable.");
    }));
  });
  return bus;
}
