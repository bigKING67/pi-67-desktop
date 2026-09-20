import type { Duplex } from "node:stream";
import { TeamModelRelay, type TeamModelRelayPort } from "@pi67/protocol";

/** Main relays only bytes; it does not authorize or execute model requests. */
export function relayNativeTeamModelWorker(native: Duplex, port: TeamModelRelayPort, signal: AbortSignal) {
  const relay = new TeamModelRelay(port, {
    accept: bytes => new Promise<void>((resolve, reject) => {
      if (native.destroyed) { reject(new Error("Team worker channel closed.")); return; }
      native.write(bytes, error => error ? reject(new Error("Team worker channel unavailable.")) : resolve());
    }),
    close() {
      signal.removeEventListener("abort", stop);
      native.removeListener("data", data); native.removeListener("end", stop); native.removeListener("close", stop);
      native.destroy();
    }
  });
  const stop = () => relay.stop();
  const data = (bytes: Buffer) => {
    native.pause();
    void relay.write(bytes).then(() => { if (!native.destroyed) native.resume(); }, stop);
  };
  native.on("data", data); native.on("error", stop); native.on("end", stop); native.on("close", stop);
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted || native.destroyed) stop(); else relay.start();
  return { stop };
}
