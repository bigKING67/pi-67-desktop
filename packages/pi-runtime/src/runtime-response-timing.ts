import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { RuntimeResponseTiming, StreamDelta } from "@pi67/protocol";

type Milestone = Exclude<keyof RuntimeResponseTiming, "sequence" | "status" | "elapsedMs">;

/** Per-runtime bounded, content-free receipts; all times are relative to submit entry. */
export class RuntimeResponseTimings {
  private readonly receipts: ResponseTimingFlight[] = [];
  private sequence = 0;
  private current: ResponseTimingFlight | undefined;

  constructor(private readonly now: () => number = () => performance.now()) {}

  begin(): ResponseTimingFlight {
    this.current?.finish("interrupted");
    const flight = new ResponseTimingFlight(++this.sequence, this.now);
    this.current = flight;
    this.receipts.push(flight);
    if (this.receipts.length > 8) this.receipts.shift();
    return flight;
  }

  emitted(events: readonly StreamDelta[]): void {
    for (const { assistantMessageEvent: event } of events) {
      if (!event.delta) continue;
      this.current?.emitted(event.type);
    }
  }

  snapshot(): NonNullable<import("@pi67/protocol").RuntimeDiagnostics["responseTiming"]> {
    return { scope: "runtime-to-stream-emission", receipts: this.receipts.map(receipt => receipt.snapshot()) };
  }
}

class ResponseTimingFlight {
  private readonly started: number;
  private readonly receipt: RuntimeResponseTiming;

  constructor(sequence: number, private readonly now: () => number) {
    this.started = now();
    this.receipt = { sequence, status: "running", elapsedMs: 0 };
  }

  mark(stage: Milestone): void {
    if (this.receipt.status !== "running" || this.receipt[stage] !== undefined) return;
    this.receipt[stage] = this.elapsed();
  }

  observe(event: AgentSessionEvent): void {
    if (this.receipt.sdkPromptInvokedMs === undefined) return;
    if (event.type === "agent_start") this.mark("sdkAgentStartedMs");
    if (event.type !== "message_update") return;
    const delta = event.assistantMessageEvent;
    if (delta.type === "thinking_delta" && delta.delta) this.mark("firstThinkingMs");
    if (delta.type === "text_delta" && delta.delta) this.mark("firstTextMs");
  }

  emitted(type: "thinking_delta" | "text_delta"): void {
    if (type === "thinking_delta" && this.receipt.firstThinkingMs !== undefined) this.mark("firstThinkingEmittedMs");
    if (type === "text_delta" && this.receipt.firstTextMs !== undefined) this.mark("firstTextEmittedMs");
  }

  finish(status: Exclude<RuntimeResponseTiming["status"], "running">): void {
    if (this.receipt.status !== "running") return;
    this.receipt.elapsedMs = this.elapsed();
    this.receipt.status = status;
  }

  snapshot(): RuntimeResponseTiming {
    return { ...this.receipt, elapsedMs: this.receipt.status === "running" ? this.elapsed() : this.receipt.elapsedMs };
  }

  private elapsed(): number {
    return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(this.now() - this.started)));
  }
}
