export class StreamBatcher<T> {
  private pending: T[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly flushHandler: (events: T[]) => void, private readonly intervalMs = 50) {}

  push(event: T): void {
    this.pending.push(event);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.intervalMs);
  }

  drop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = [];
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
