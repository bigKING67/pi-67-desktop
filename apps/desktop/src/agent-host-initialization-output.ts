const INITIALIZATION_PREFIX = "[agent-host:init] ";
const MAX_PENDING_LINE_LENGTH = 8_192;

const INITIALIZATION_STAGES = new Set([
  "resolve-session",
  "dispose-current",
  "create-session",
  "load-model-runtime",
  "reload-configuration",
  "project-snapshot"
]);

const INITIALIZATION_OUTCOMES = new Set(["started", "completed", "failed"]);

export class AgentHostInitializationOutputForwarder {
  readonly #emit: (line: string) => void;
  #pending = "";

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
}
