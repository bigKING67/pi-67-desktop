import { MessageChannelMain, type UtilityProcess } from "electron";
import type { Duplex } from "node:stream";
import { isTeamModelPortAttach } from "@pi67/protocol";
import { relayNativeTeamModelWorker } from "./native-team-model-relay.js";

/** Main-only transfer, bound to one ready Host. The future worker owner supplies
 * a Host-reserved request ID and an admitted native channel, never Renderer input.
 */
export class TeamModelPortSupervisor {
  private readonly entries = new Map<string, { stop(): void }>();
  constructor(private readonly currentHost: () => UtilityProcess | undefined) {}

  attach(requestId: string, native: Duplex, signal: AbortSignal) {
    const host = this.currentHost(), message = { type: "team-model-port-attach", requestId };
    if (!host || signal.aborted || native.destroyed || !isTeamModelPortAttach(message)
      || this.entries.size >= 4 || this.entries.has(requestId)) {
      native.destroy(); throw new Error("Team model port transfer unavailable.");
    }
    let ports: MessageChannelMain;
    try { ports = new MessageChannelMain(); }
    catch { native.destroy(); throw new Error("Team model port transfer unavailable."); }
    const { port1, port2 } = ports;
    let relay: ReturnType<typeof relayNativeTeamModelWorker> | undefined, retired = false;
    const stop = () => {
      if (retired) return;
      retired = true; this.entries.delete(requestId);
      host.off("exit", stop); native.removeListener("close", stop); signal.removeEventListener("abort", stop);
      relay?.stop(); port1.close(); port2.close(); native.destroy();
    };
    this.entries.set(requestId, { stop });
    host.on("exit", stop); native.once("close", stop); signal.addEventListener("abort", stop, { once: true });
    try {
      relay = relayNativeTeamModelWorker(native, port1, signal);
      if (retired || this.currentHost() !== host) throw new Error("Host replaced.");
      host.postMessage(message, [port2]);
    } catch { stop(); throw new Error("Team model port transfer unavailable."); }
    return { stop };
  }

  invalidate(): void { for (const entry of this.entries.values()) entry.stop(); }
}
