import { NATIVE_TEAM_MODEL_MAX_FRAME } from "./native-team-model.js";

export interface TeamModelRelayPort {
  postMessage(message: unknown): void;
  on(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): unknown;
  off(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): unknown;
  start?(): void;
  close(): void;
}
export const TEAM_MODEL_RELAY_MAX_CHUNK = NATIVE_TEAM_MODEL_MAX_FRAME + 4;
type RelayMessage = { type: "team-model-relay-data"; sequence: number; bytes: Uint8Array }
  | { type: "team-model-relay-ack"; sequence: number };
export function isTeamModelRelayMessage(value: unknown): value is RelayMessage {
  if (!value || typeof value !== "object" || !("type" in value) || !("sequence" in value)
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return false;
  if (value.type === "team-model-relay-ack") return Object.keys(value).length === 2;
  return value.type === "team-model-relay-data" && Object.keys(value).length === 3 && "bytes" in value
    && value.bytes instanceof Uint8Array && value.bytes.buffer instanceof ArrayBuffer
    && value.bytes.byteLength > 0 && value.bytes.byteLength <= TEAM_MODEL_RELAY_MAX_CHUNK;
}

/** Dedicated Main/Host capability port, never a Renderer port. One unacknowledged
 * chunk per direction, no retry/reconnect/queue. ACK means sink accepted bytes,
 * not model authorization, completion, or index publication.
 */
export class TeamModelRelay {
  private stopped = false;
  private sending = 0;
  private receiving = 0;
  private incoming = false;
  private incomingTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: { sequence: number; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | undefined;
  constructor(private readonly port: TeamModelRelayPort, private readonly sink: {
    accept(bytes: Uint8Array): Promise<void>;
    close(): void;
  }) {
    port.on("message", this.message); port.on("messageerror", this.stop); port.on("close", this.stop);
  }
  start(): void { if (!this.stopped) this.port.start?.(); }
  write(bytes: Uint8Array): Promise<void> {
    if (this.stopped || this.pending || bytes.byteLength === 0 || bytes.byteLength > TEAM_MODEL_RELAY_MAX_CHUNK
      || this.sending >= Number.MAX_SAFE_INTEGER) { this.stop(); return Promise.reject(new Error("Team model relay unavailable.")); }
    return new Promise<void>((resolve, reject) => {
      const sequence = ++this.sending;
      this.pending = { sequence, resolve, reject, timer: setTimeout(this.stop, 10_000) };
      try { this.port.postMessage({ type: "team-model-relay-data", sequence, bytes: new Uint8Array(bytes) }); }
      catch { this.stop(); }
    });
  }
  readonly stop = (): void => {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.incomingTimer);
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error("Team model relay unavailable.")); }
    this.port.off("message", this.message); this.port.off("messageerror", this.stop); this.port.off("close", this.stop);
    try { this.sink.close(); } finally { this.port.close(); }
  };
  private readonly message = (event: unknown): void => {
    if (this.stopped) return;
    // Electron MessagePortMain wraps data; Node MessagePort passes it directly.
    const value = event && typeof event === "object" && "data" in event ? event.data : event;
    if (!isTeamModelRelayMessage(value)) { this.stop(); return; }
    if (value.type === "team-model-relay-ack") {
      const pending = this.pending;
      if (!pending || pending.sequence !== value.sequence) { this.stop(); return; }
      this.pending = undefined; clearTimeout(pending.timer); pending.resolve(); return;
    }
    if (this.incoming || value.sequence !== this.receiving + 1) { this.stop(); return; }
    this.incoming = true; this.receiving = value.sequence;
    this.incomingTimer = setTimeout(this.stop, 10_000);
    void this.accept(value);
  };
  private async accept(value: Extract<RelayMessage, { type: "team-model-relay-data" }>) {
    try {
      await this.sink.accept(new Uint8Array(value.bytes));
      if (this.stopped) return;
      clearTimeout(this.incomingTimer); this.incoming = false;
      this.port.postMessage({ type: "team-model-relay-ack", sequence: value.sequence });
    } catch { this.stop(); }
  }
}
