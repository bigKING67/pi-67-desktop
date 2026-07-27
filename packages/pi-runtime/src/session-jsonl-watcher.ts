import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import {
  createSessionJsonlTailCursor,
  drainSessionJsonlTail,
  SessionJsonlTailError,
  type SessionJsonlChangeReason,
  type SessionJsonlTailCursor,
  type SessionJsonlTailLimits
} from "./session-jsonl-tail.js";

const SESSION_JSONL_WATCH_DEBOUNCE_MS = 75;
const SESSION_JSONL_MAX_DRAIN_PASSES = 64;

export interface SessionJsonlExternalChange {
  reason: SessionJsonlChangeReason;
  recoverable: boolean;
}

export interface SessionJsonlWatcherBinding {
  path: string;
  generation: number;
  getExpectedRecords: () => ReadonlyArray<Record<string, unknown>>;
  onExternalChange: (change: SessionJsonlExternalChange) => void;
}

export interface SessionJsonlWatcherOptions extends SessionJsonlTailLimits {
  debounceMs?: number;
  maxDrainPasses?: number;
}

interface ActiveBinding extends SessionJsonlWatcherBinding {
  token: number;
  fileName: string;
}

/**
 * Uses fs.watch only as a dirty signal. File identity, byte offsets and JSONL
 * validation are re-established from the file itself before any change is trusted.
 */
export class SessionJsonlWatcher {
  private binding: ActiveBinding | undefined;
  private cursor: SessionJsonlTailCursor | undefined;
  private watchers: FSWatcher[] = [];
  private knownRecordKeys = new Set<string>();
  private dirty = false;
  private detected = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private drainPromise: Promise<void> | undefined;
  private token = 0;

  constructor(private readonly options: SessionJsonlWatcherOptions = {}) {}

  async bind(binding: SessionJsonlWatcherBinding): Promise<void> {
    this.dispose();
    const token = this.token;
    const active: ActiveBinding = {
      ...binding,
      token,
      fileName: basename(binding.path)
    };
    this.binding = active;

    try {
      const cursor = await createSessionJsonlTailCursor(binding.path, this.options);
      if (!this.isCurrent(token)) return;
      this.cursor = cursor;
      this.knownRecordKeys = cursor.fileIdentity === undefined
        ? new Set()
        : new Set(binding.getExpectedRecords().map(recordKey).filter(isString));
      const directoryWatcher = watch(dirname(cursor.path), { persistent: false }, (_eventType, fileName) => {
        if (!this.isCurrent(token)) return;
        if (fileName !== null && fileName.toString() !== active.fileName) return;
        this.scheduleDrain(token);
      });
      this.registerWatcher(directoryWatcher, token);
      // Close the baseline-to-watch registration race with an authoritative stat/read.
      await this.checkNow();
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.detect(changeFromError(error));
    }
  }

  async checkNow(): Promise<void> {
    if (!this.binding || !this.cursor || this.detected) return;
    this.dirty = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.drainPromise) {
      const token = this.binding.token;
      this.drainPromise = this.drain(token).finally(() => {
        if (this.binding?.token === token) this.drainPromise = undefined;
      });
    }
    await this.drainPromise;
  }

  dispose(): void {
    this.token += 1;
    this.binding = undefined;
    this.cursor = undefined;
    this.knownRecordKeys.clear();
    this.dirty = false;
    this.detected = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.closeWatchers();
    this.drainPromise = undefined;
  }

  private async drain(token: number): Promise<void> {
    const maxDrainPasses = positiveInteger(
      this.options.maxDrainPasses ?? SESSION_JSONL_MAX_DRAIN_PASSES,
      "maxDrainPasses"
    );
    let passes = 0;
    while (this.dirty && this.isCurrent(token) && !this.detected) {
      this.dirty = false;
      const cursor = this.cursor;
      if (!cursor) return;
      const result = await drainSessionJsonlTail(cursor, this.options);
      if (!this.isCurrent(token) || this.detected) return;
      if (result.kind === "conflict") {
        this.detect({ reason: result.reason, recoverable: result.recoverable });
        return;
      }
      this.cursor = result.cursor;
      if (result.kind === "unchanged") continue;
      if (!this.acceptExpectedAppend(result.records, result.physicalLineCount, result.ignoredLineCount)) {
        this.detect({ reason: "appended", recoverable: true });
        return;
      }
      if (!result.more && result.cursor.pendingLine.byteLength > 0) {
        this.detect({ reason: "invalid", recoverable: false });
        return;
      }
      if (result.more) this.dirty = true;
      passes += 1;
      if (passes >= maxDrainPasses && this.dirty) {
        this.detect({ reason: "invalid", recoverable: false });
        return;
      }
      if (this.dirty) await yieldToEventLoop();
    }
  }

  private acceptExpectedAppend(
    records: ReadonlyArray<Record<string, unknown>>,
    physicalLineCount: number,
    ignoredLineCount: number
  ): boolean {
    if (ignoredLineCount > 0 || physicalLineCount !== records.length) return false;
    const expectedByKey = new Map(
      this.binding?.getExpectedRecords()
        .map((record) => [recordKey(record), record] as const)
        .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[0] !== undefined)
    );
    for (const record of records) {
      const key = recordKey(record);
      if (!key || this.knownRecordKeys.has(key)) return false;
      const expected = expectedByKey.get(key);
      if (!expected || JSON.stringify(record) !== JSON.stringify(expected)) return false;
      this.knownRecordKeys.add(key);
    }
    return true;
  }

  private scheduleDrain(token: number): void {
    if (this.detected || !this.isCurrent(token)) return;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    const debounceMs = nonNegativeInteger(
      this.options.debounceMs ?? SESSION_JSONL_WATCH_DEBOUNCE_MS,
      "debounceMs"
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.isCurrent(token)) return;
      void this.checkNow().catch((error: unknown) => {
        if (this.isCurrent(token)) this.detect(changeFromError(error));
      });
    }, debounceMs);
  }

  private detect(change: SessionJsonlExternalChange): void {
    if (this.detected) return;
    const binding = this.binding;
    if (!binding) return;
    this.detected = true;
    this.dirty = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.closeWatchers();
    binding.onExternalChange(change);
  }

  private registerWatcher(watcher: FSWatcher, token: number): void {
    watcher.on("error", () => {
      if (this.isCurrent(token)) this.detect({ reason: "unavailable", recoverable: true });
    });
    this.watchers.push(watcher);
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  private isCurrent(token: number): boolean {
    return this.binding?.token === token;
  }
}

function recordKey(record: Record<string, unknown>): string | undefined {
  if (record.type === "session" && typeof record.id === "string") return `session:${record.id}`;
  return typeof record.id === "string" ? `entry:${record.id}` : undefined;
}

function changeFromError(error: unknown): SessionJsonlExternalChange {
  return error instanceof SessionJsonlTailError
    ? { reason: error.reason, recoverable: error.recoverable }
    : { reason: "unavailable", recoverable: true };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
  return value;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolveYield) => setTimeout(resolveYield, 0));
}
