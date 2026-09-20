import { Duplex } from "node:stream";
import { TeamModelRelay, type TeamModelRelayPort } from "@pi67/protocol";

/** Host-only adaptation of a dedicated transferred port. The existing enterprise
 * controller must admit the returned stream with trusted identity/model selection.
 */
export function createTeamModelPortChannel(port: TeamModelRelayPort): Duplex {
  let pending: { resolve(): void; reject(error: Error): void } | undefined;
  const stream = new Duplex({
    read() { const accepted = pending; pending = undefined; accepted?.resolve(); },
    write(chunk: Buffer, _encoding, done) { void relay.write(chunk).then(() => done(), () => done(new Error("Team model relay unavailable."))); },
    destroy(error, done) {
      const accepted = pending; pending = undefined; accepted?.reject(new Error("Team model channel closed."));
      relay.stop(); done(error);
    }
  });
  const relay = new TeamModelRelay(port, {
    accept: bytes => new Promise<void>((resolve, reject) => {
      if (stream.destroyed) { reject(new Error("Team model channel closed.")); return; }
      pending = { resolve, reject };
      if (stream.push(bytes)) { pending = undefined; resolve(); }
    }),
    close() { stream.destroy(); }
  });
  stream.on("error", () => relay.stop());
  relay.start();
  return stream;
}
