const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_MAX_CHUNK_CHARACTERS = 240;
const SENTENCE_BOUNDARY = /[。！？；.!?;\n]/u;

export interface StreamingAnnouncementAuthority {
  hostEpoch?: number;
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
}

interface StreamingAnnouncerSchedulerOptions {
  announce: (text: string) => void;
  intervalMs?: number;
  maxChunkCharacters?: number;
  now?: () => number;
}

export class StreamingAnnouncerScheduler {
  private readonly announce: (text: string) => void;
  private readonly intervalMs: number;
  private readonly maxChunkCharacters: number;
  private readonly now: () => number;
  private authorityKey: string | undefined;
  private cumulativeText = "";
  private pendingText = "";
  private lastAnnouncementAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: StreamingAnnouncerSchedulerOptions) {
    this.announce = options.announce;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxChunkCharacters = options.maxChunkCharacters ?? DEFAULT_MAX_CHUNK_CHARACTERS;
    this.now = options.now ?? Date.now;
  }

  update(text: string, authority: StreamingAnnouncementAuthority | undefined): void {
    const nextAuthorityKey = authority === undefined ? undefined : authorityKey(authority);
    if (nextAuthorityKey === undefined) {
      this.reset();
      return;
    }
    if (nextAuthorityKey !== this.authorityKey) {
      this.clear(false);
      this.authorityKey = nextAuthorityKey;
      this.announce("");
    }

    if (!text.startsWith(this.cumulativeText)) {
      this.cumulativeText = "";
      this.pendingText = "";
      this.cancelTimer();
      this.announce("");
    }
    const delta = text.slice(this.cumulativeText.length);
    this.cumulativeText = text;
    if (!delta) return;
    this.pendingText += delta;
    this.schedule();
  }

  reset(): void {
    if (
      this.authorityKey === undefined
      && !this.cumulativeText
      && !this.pendingText
      && this.timer === undefined
    ) return;
    this.clear(true);
    this.announce("");
  }

  dispose(): void {
    this.clear(true);
  }

  private schedule(): void {
    if (this.timer !== undefined || !this.pendingText) return;
    const elapsed = this.now() - this.lastAnnouncementAt;
    const delay = Number.isFinite(elapsed) ? Math.max(0, this.intervalMs - elapsed) : 0;
    if (delay === 0) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, delay);
  }

  private flush(): void {
    if (!this.pendingText) return;
    const { announcement, remainder } = takeStreamingAnnouncementChunk(
      this.pendingText,
      this.maxChunkCharacters
    );
    this.pendingText = remainder;
    const readable = announcement.replace(/\s+/gu, " ").trim();
    if (readable) {
      this.lastAnnouncementAt = this.now();
      this.announce(readable);
    }
    if (this.pendingText) this.schedule();
  }

  private clear(resetAuthority: boolean): void {
    this.cancelTimer();
    if (resetAuthority) this.authorityKey = undefined;
    this.cumulativeText = "";
    this.pendingText = "";
    this.lastAnnouncementAt = Number.NEGATIVE_INFINITY;
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export function takeStreamingAnnouncementChunk(
  value: string,
  maxCharacters = DEFAULT_MAX_CHUNK_CHARACTERS
): { announcement: string; remainder: string } {
  const characters = Array.from(value);
  const boundedLength = Math.min(characters.length, maxCharacters);
  let splitAt = boundedLength;
  for (let index = boundedLength - 1; index >= 0; index -= 1) {
    if (SENTENCE_BOUNDARY.test(characters[index]!)) {
      splitAt = index + 1;
      break;
    }
  }
  return {
    announcement: characters.slice(0, splitAt).join(""),
    remainder: characters.slice(splitAt).join("")
  };
}

function authorityKey(authority: StreamingAnnouncementAuthority): string {
  return [
    authority.hostEpoch ?? "",
    authority.sessionId ?? "",
    authority.sessionGeneration ?? "",
    authority.operationId ?? ""
  ].join(":");
}
