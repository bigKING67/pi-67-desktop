const INITIALIZATION_PREFIX = "[agent-host:init] ";
const PROMPT_ACK_PREFIX = "[agent-host:prompt-ack] ";
const SHUTDOWN_PREFIX = "[agent-host:shutdown] ";
const MAX_PENDING_LINE_LENGTH = 8_192;

const INITIALIZATION_STAGES = new Set([
  "resolve-session",
  "dispose-current",
  "create-session",
  "load-model-runtime",
  "validate-packages",
  "load-session-resources",
  "activate-session",
  "reload-configuration",
  "project-snapshot",
  // Sub-phases of the startup `desktop-capabilities` stage.
  "capability-source-verify",
  "capability-profile-inspect",
  "capability-profile-copy",
  "capability-profile-verify"
]);

const INITIALIZATION_OUTCOMES = new Set(["started", "completed", "failed"]);
const SHUTDOWN_STAGES = new Set([
  "host-operations", "host-task-runtimes", "host-compatibility-runtime",
  "host-writer-leases", "host-requests", "host-workspaces", "host-credentials", "host-attachments",
  "operation-abort", "operation-execution", "operation-queues", "operation-receipt",
  "operation-prompt-catalog", "operation-prompt-configuration",
  "receipt-directory", "receipt-lock", "receipt-read", "receipt-open", "receipt-write",
  "receipt-file-sync", "receipt-close", "receipt-replace", "receipt-directory-sync", "receipt-unlock",
  "runtime-subagents", "runtime-configuration", "runtime-session", "runtime-catalog"
]);
const PROMPT_ACK_STAGES = new Set([
  "received", "dispatch-started", "runtime-ready",
  "receipt-reconcile-started", "receipt-reconcile-completed",
  "receipt-write-started", "receipt-write-completed",
  "response-ready", "response-error-ready", "response-posted", "response-failed"
]);

export class AgentHostInitializationOutputForwarder {
  readonly #emit: (line: string) => void;
  #pending = "";
  #promptRecords = 0;
  #shutdownRecords = 0;

  constructor(emit: (line: string) => void) {
    this.#emit = emit;
  }

  write(chunk: unknown): void {
    const lines = `${this.#pending}${String(chunk)}`.split(/\r?\n/u);
    this.#pending = lines.pop() ?? "";
    for (const line of lines) this.#forward(line);
    if (this.#pending.length > MAX_PENDING_LINE_LENGTH) this.#pending = "";
  }

  #forward(line: string): void {
    if (line.length > MAX_PENDING_LINE_LENGTH) return;
    if (line.startsWith(SHUTDOWN_PREFIX)) {
      this.#forwardShutdown(line);
      return;
    }
    if (line.startsWith(PROMPT_ACK_PREFIX)) {
      this.#forwardPromptAcknowledgement(line);
      return;
    }
    if (!line.startsWith(INITIALIZATION_PREFIX)) return;
    try {
      const value = JSON.parse(line.slice(INITIALIZATION_PREFIX.length)) as Record<string, unknown>;
      if (
        typeof value.stage !== "string"
        || !INITIALIZATION_STAGES.has(value.stage)
        || typeof value.outcome !== "string"
        || !INITIALIZATION_OUTCOMES.has(value.outcome)
        || typeof value.durationMs !== "number"
        || !Number.isFinite(value.durationMs)
      ) return;
      this.#emit(`${INITIALIZATION_PREFIX}${JSON.stringify({
        stage: value.stage,
        outcome: value.outcome,
        durationMs: Math.max(0, Math.round(value.durationMs))
      })}`);
    } catch {
      // Utility stderr is untrusted diagnostics; malformed records are ignored.
    }
  }

  #forwardShutdown(line: string): void {
    if (this.#shutdownRecords >= 128) return;
    try {
      const value = JSON.parse(line.slice(SHUTDOWN_PREFIX.length)) as Record<string, unknown>;
      if (typeof value.stage !== "string" || !SHUTDOWN_STAGES.has(value.stage)
        || typeof value.outcome !== "string" || !INITIALIZATION_OUTCOMES.has(value.outcome)
        || typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence)
        || value.sequence < 1 || value.sequence > 64
        || typeof value.durationMs !== "number" || !Number.isSafeInteger(value.durationMs)
        || value.durationMs < 0 || value.durationMs > 60_000) return;
      this.#shutdownRecords += 1;
      this.#emit(`${SHUTDOWN_PREFIX}${JSON.stringify({
        sequence: value.sequence, stage: value.stage, outcome: value.outcome, durationMs: value.durationMs
      })}`);
    } catch {
      // Project only fixed fields from untrusted utility stderr.
    }
  }

  #forwardPromptAcknowledgement(line: string): void {
    if (this.#promptRecords >= 1_024) return;
    try {
      const value = JSON.parse(line.slice(PROMPT_ACK_PREFIX.length)) as Record<string, unknown>;
      if (typeof value.stage !== "string" || !PROMPT_ACK_STAGES.has(value.stage)
        || typeof value.attempt !== "number" || !Number.isSafeInteger(value.attempt)
        || value.attempt < 1 || value.attempt > 64
        || typeof value.elapsedMs !== "number" || !Number.isSafeInteger(value.elapsedMs)
        || value.elapsedMs < 0) return;
      this.#promptRecords += 1;
      this.#emit(`${PROMPT_ACK_PREFIX}${JSON.stringify({
        attempt: value.attempt, stage: value.stage, elapsedMs: value.elapsedMs
      })}`);
    } catch {
      // Project fixed fields only; stderr is not a trusted diagnostic document.
    }
  }
}
