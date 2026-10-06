// ADR 0003: the only production file permitted to open a WebSocket. It is an
// outbound, push-only connection to the configured New Money origin; every
// mutation and every reconciliation read stays on HTTPS.
import type { TeamChatConnectionState, TeamChatPushEvent } from "@pi67/domain";
import { asRecord, boundedInteger, boundedString } from "../context/enterprise-context-gateway-validation.js";
import { HostCommandError } from "../protocol-error.js";
import { parseInvocationSummary, parseMessage } from "./team-chat-message-parse.js";
import { parseWorkCard } from "./team-chat-work-card-parse.js";

const MAX_FRAME_CHARS = 64 * 1024;
const MAX_BACKOFF_MS = 30_000;
const CREDENTIAL_SETTLE_MS = 1_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;
/** Service close code: the access token expired; reconnect immediately with a fresh ticket. */
const CLOSE_EXPIRED = 4001;

export interface TeamChatSocket {
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  close(code?: number, reason?: string): void;
}

/** Owner-only frame the Host handles itself (ADR 0004); never forwarded to the renderer. */
export interface TeamChatAgentInvokedFrame {
  type: "agent.invoked";
  invocationId: string;
  agentUserId: string;
  conversationId: string;
}

export interface TeamChatRealtimeOptions {
  /** Resolves the socket URL, including a freshly issued single-use ticket. */
  resolveUrl(signal: AbortSignal): Promise<string>;
  hasCredential(): boolean;
  /** Aborted before any credential replacement or clear. */
  credentialSignal(): AbortSignal;
  onState(state: TeamChatConnectionState): void;
  onPush(event: TeamChatPushEvent | TeamChatAgentInvokedFrame): void;
  openSocket?: (url: string) => TeamChatSocket;
  heartbeatTimeoutMs?: number;
  random?: () => number;
}

type SessionOutcome = "stopped" | "credential-changed" | "expired" | "was-live" | "failed";

export function teamChatRealtimeUrl(endpoint: string, teamId: string, ticket: string): string {
  const url = new URL(`${endpoint.replace(/\/+$/u, "")}/v1/agent/teams/${encodeURIComponent(teamId)}/chat/realtime`);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) url.protocol = "ws:";
  else throw new HostCommandError("INVALID_PAYLOAD", "Team Chat requires an HTTPS New Money endpoint.", false);
  url.searchParams.set("ticket", ticket);
  return url.href;
}

export class TeamChatRealtime {
  readonly #lifetime = new AbortController();
  /** Aborted to reconnect with a fresh ticket (for example after Agent hosting changes). */
  #refresh = new AbortController();
  #running = false;
  #generation = 0;
  #state: TeamChatConnectionState = { status: "signed-out" };

  constructor(private readonly options: TeamChatRealtimeOptions) {}

  get state(): TeamChatConnectionState { return this.#state; }

  start(): void {
    if (this.#running || this.#lifetime.signal.aborted) return;
    this.#running = true;
    void this.#run();
  }

  stop(): void { this.#lifetime.abort(); }

  /** Drops the current socket and reconnects at once with a newly issued ticket. */
  reconnect(): void {
    const previous = this.#refresh;
    this.#refresh = new AbortController();
    previous.abort();
  }

  async #run(): Promise<void> {
    let attempt = 0;
    while (!this.#lifetime.signal.aborted) {
      const credentialSignal = AbortSignal.any([this.options.credentialSignal(), this.#refresh.signal]);
      if (!this.options.hasCredential()) {
        this.#setState({ status: "signed-out" });
        await this.#waitForCredentialChange(credentialSignal);
        attempt = 0;
        continue;
      }
      if (attempt === 0) this.#setState({ status: "connecting" });
      let outcome: SessionOutcome;
      try {
        const url = await this.options.resolveUrl(AbortSignal.any([this.#lifetime.signal, credentialSignal]));
        outcome = await this.#session(url, credentialSignal);
      } catch (error) {
        if (this.#lifetime.signal.aborted) return;
        const reason = unavailableReason(error);
        if (reason !== undefined) {
          this.#setState({ status: "unavailable", reason });
          await this.#waitForCredentialChange(credentialSignal);
          attempt = 0;
          continue;
        }
        outcome = credentialSignal.aborted ? "credential-changed" : "failed";
      }
      if (outcome === "stopped") return;
      if (outcome === "credential-changed" || outcome === "expired") {
        attempt = 0;
        continue;
      }
      attempt = outcome === "was-live" ? 1 : attempt + 1;
      const random = this.options.random ?? Math.random;
      const delay = Math.round(Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (attempt - 1)) * (0.5 + random() / 2));
      this.#setState({ status: "reconnecting", retryAt: Date.now() + delay });
      await this.#sleep(delay, credentialSignal);
    }
  }

  #session(url: string, credentialSignal: AbortSignal): Promise<SessionOutcome> {
    return new Promise((resolve) => {
      const socket = (this.options.openSocket ?? openWebSocket)(url);
      let live = false;
      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const onStop = () => finish("stopped");
      const onCredential = () => finish("credential-changed");
      const finish = (outcome: SessionOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        this.#lifetime.signal.removeEventListener("abort", onStop);
        credentialSignal.removeEventListener("abort", onCredential);
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try { socket.close(1000, "client"); } catch { /* already closed */ }
        resolve(outcome);
      };
      const arm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => finish(live ? "was-live" : "failed"),
          this.options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS);
        watchdog.unref?.();
      };
      this.#lifetime.signal.addEventListener("abort", onStop, { once: true });
      credentialSignal.addEventListener("abort", onCredential, { once: true });
      if (this.#lifetime.signal.aborted) return finish("stopped");
      if (credentialSignal.aborted) return finish("credential-changed");
      arm();
      socket.onmessage = (event) => {
        arm();
        const frame = parseFrame(event.data);
        if (frame === undefined) return finish(live ? "was-live" : "failed");
        if (frame === "ready") {
          live = true;
          this.#generation += 1;
          this.#setState({ status: "live", generation: this.#generation });
        } else if (typeof frame === "object" && live) {
          this.options.onPush(frame);
        }
      };
      socket.onclose = (event) => finish(event.code === CLOSE_EXPIRED ? "expired" : live ? "was-live" : "failed");
      socket.onerror = () => undefined;
    });
  }

  #waitForCredentialChange(credentialSignal: AbortSignal): Promise<void> {
    // A retired signal is renewed once the broker acknowledges; poll until then.
    return credentialSignal.aborted ? this.#sleep(CREDENTIAL_SETTLE_MS) : this.#sleep(Number.POSITIVE_INFINITY, credentialSignal);
  }

  #sleep(ms: number, interrupt?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const signals = interrupt === undefined ? [this.#lifetime.signal] : [this.#lifetime.signal, interrupt];
      const combined = AbortSignal.any(signals);
      if (combined.aborted) return resolve();
      const timer = Number.isFinite(ms) ? setTimeout(done, ms) : undefined;
      timer?.unref?.();
      combined.addEventListener("abort", done, { once: true });
      function done() {
        clearTimeout(timer);
        combined.removeEventListener("abort", done);
        resolve();
      }
    });
  }

  #setState(next: TeamChatConnectionState): void {
    if (this.#lifetime.signal.aborted || JSON.stringify(next) === JSON.stringify(this.#state)) return;
    this.#state = next;
    this.options.onState(next);
  }
}

function openWebSocket(url: string): TeamChatSocket {
  return new WebSocket(url) as unknown as TeamChatSocket;
}

/**
 * Service refusals stop reconnecting until the credential changes; transport and
 * 5xx failures (RuntimeError or recoverable errors) keep the bounded backoff.
 */
function unavailableReason(error: unknown): "entitlement-inactive" | "not-member" | "rejected" | undefined {
  if (!(error instanceof HostCommandError)) return undefined;
  const code = error.details?.serviceError;
  if (code === "entitlement_inactive") return "entitlement-inactive";
  if (code === "team_not_found" || code === "device_team_scope") return "not-member";
  // Generic 401/403/4xx from New Money, including a refused credential refresh.
  if (error.code === "RUNTIME_NOT_READY" && !error.recoverable) return "rejected";
  return undefined;
}

/** Returns a push event, a control/ignored frame, or undefined for a malformed frame. */
export function parseFrame(
  data: unknown
): TeamChatPushEvent | TeamChatAgentInvokedFrame | "ready" | "heartbeat" | "ignored" | undefined {
  if (typeof data !== "string" || data.length > MAX_FRAME_CHARS) return undefined;
  try {
    const record = asRecord(JSON.parse(data) as unknown);
    switch (record.type) {
      case "ready":
      case "heartbeat":
        return record.type;
      case "message.created":
        return { type: "message.created", message: parseMessage(record.message) };
      case "message.updated":
        return { type: "message.updated", message: parseMessage(record.message) };
      case "work_card.changed":
        return { type: "work_card.changed", card: parseWorkCard(record.card) };
      case "policy.changed":
        return { type: "policy.changed" };
      case "agents.changed":
        return { type: "agents.changed" };
      case "activity.changed":
        return { type: "activity.changed" };
      case "agent_invocation.changed":
        return {
          type: "agent_invocation.changed",
          conversationId: boundedString(record.conversationId, "conversationId", 128),
          messageId: boundedString(record.messageId, "messageId", 128),
          invocation: parseInvocationSummary(record.invocation)
        };
      case "agent.invoked":
        return {
          type: "agent.invoked",
          invocationId: boundedString(record.invocationId, "invocationId", 128),
          agentUserId: boundedString(record.agentUserId, "agentUserId", 128),
          conversationId: boundedString(record.conversationId, "conversationId", 128)
        };
      case "conversation.changed":
        return { type: "conversation.changed", conversationId: boundedString(record.conversationId, "conversationId", 128) };
      case "read.changed":
        return {
          type: "read.changed",
          conversationId: boundedString(record.conversationId, "conversationId", 128),
          lastReadSeq: boundedInteger(record.lastReadSeq, "lastReadSeq", 0)
        };
      default:
        // Newer service event types are ignored rather than forcing a reconnect.
        return typeof record.type === "string" ? "ignored" : undefined;
    }
  } catch {
    return undefined;
  }
}
