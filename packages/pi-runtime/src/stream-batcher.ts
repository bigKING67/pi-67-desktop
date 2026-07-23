export class StreamBatcher {
  private pending: unknown[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly flushHandler: (events: unknown[]) => void, private readonly intervalMs = 50) {}

  push(event: unknown): void {
    this.pending.push(event);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.intervalMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.length === 0) return;
    const events = this.pending;
    this.pending = [];
    this.flushHandler(events);
  }

  dispose(): void {
    this.flush();
  }
}
