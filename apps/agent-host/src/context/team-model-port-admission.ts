import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { isTeamModelPortAttach, TEAM_WORKER_HANDOFF_TIMEOUT_MS, TEAM_WORKER_PREPARATION_TIMEOUT_MS, type TeamModelRelayPort } from "@pi67/protocol";
import { createTeamModelPortChannel } from "./team-model-port-channel.js";

/** Internal worker owner reserves admission with its captured authorization lifetime.
 * Parent messages can only consume that reservation; they cannot create authority.
 * The synchronous admit callback must use the enterprise authorization controller.
 */
export class TeamModelPortAdmission {
  private readonly entries = new Map<string, { accept(port: TeamModelRelayPort): void; stop(): void }>();
  private stopped = false;

  reserve(admit: (channel: Duplex) => { stop(): void }, signal: AbortSignal, phase: "port" | "worker" = "port") {
    if (this.stopped || signal.aborted || this.entries.size >= 4) throw new Error("Team model port admission unavailable.");
    const requestId = randomUUID();
    const lifetime = new AbortController();
    let channel: Duplex | undefined, handle: { stop(): void } | undefined, settled = false, retired = false;
    let awaitingPreparation = phase === "worker";
    let resolve!: () => void, reject!: (error: Error) => void;
    const connected = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const stop = () => {
      if (retired) return;
      retired = true; this.entries.delete(requestId); clearTimeout(timer); lifetime.abort();
      signal.removeEventListener("abort", stop);
      channel?.removeListener("close", stop);
      try { handle?.stop(); } finally { channel?.destroy(); }
      if (!settled) { settled = true; reject(new Error("Team model port admission unavailable.")); }
    };
    const timeout = awaitingPreparation ? TEAM_WORKER_PREPARATION_TIMEOUT_MS + TEAM_WORKER_HANDOFF_TIMEOUT_MS : TEAM_WORKER_HANDOFF_TIMEOUT_MS;
    let deadline = performance.now() + timeout, timer = setTimeout(stop, timeout);
    const activate = () => {
      if (retired || !awaitingPreparation || signal.aborted || performance.now() >= deadline) {
        stop(); throw new Error("Team model port activation unavailable.");
      }
      awaitingPreparation = false; clearTimeout(timer); timer = setTimeout(stop, TEAM_WORKER_HANDOFF_TIMEOUT_MS);
      deadline = performance.now() + TEAM_WORKER_HANDOFF_TIMEOUT_MS;
    };
    this.entries.set(requestId, {
      stop,
      accept: port => {
        if (retired || awaitingPreparation || channel || signal.aborted || performance.now() >= deadline) { port.close(); stop(); return; }
        try {
          channel = createTeamModelPortChannel(port); channel.once("close", stop);
          handle = admit(channel);
          if (signal.aborted || channel.destroyed || retired) { handle.stop(); stop(); return; }
          clearTimeout(timer); settled = true; resolve();
        } catch { port.close(); stop(); }
      }
    });
    signal.addEventListener("abort", stop, { once: true });
    return { requestId, connected, stop, signal: lifetime.signal, phase, activate };
  }

  handleMessage(event: { data: unknown; ports: readonly TeamModelRelayPort[] }): boolean {
    const value = event.data;
    if (!value || typeof value !== "object" || !("type" in value) || value.type !== "team-model-port-attach") return false;
    const entry = isTeamModelPortAttach(value) ? this.entries.get(value.requestId) : undefined;
    if (!entry || this.stopped || event.ports.length !== 1) {
      for (const port of event.ports) port.close();
      entry?.stop(); return true;
    }
    entry.accept(event.ports[0]!); return true;
  }

  shutdown(): void {
    this.stopped = true;
    for (const entry of this.entries.values()) entry.stop();
  }
}
