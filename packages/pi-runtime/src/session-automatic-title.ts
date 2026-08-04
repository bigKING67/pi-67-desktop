import { open, stat } from "node:fs/promises";
import { conversationTitleCandidate } from "@pi67/domain";

const READ_CHUNK_BYTES = 128 * 1024;
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const MAX_TAIL_BYTES = 8 * 1024 * 1024;
const DEFAULT_CACHE_ITEMS = 512;
const MAX_BACKGROUND_WORKERS = 4;

interface CachedTitle {
  key: string;
  value: string | undefined;
}

export class SessionAutomaticTitleReader {
  private readonly cache = new Map<string, CachedTitle>();
  private readonly queuedCallbacks = new Map<string, Set<(path: string) => void>>();
  private readonly queue: string[] = [];
  private activeWorkers = 0;
  private generation = 0;

  constructor(private readonly maximumItems = DEFAULT_CACHE_ITEMS) {}

  async read(path: string): Promise<string | undefined> {
    const loaded = await this.load(path);
    if (!loaded) return undefined;
    this.touch(path, loaded);
    return loaded.value;
  }

  peek(path: string): string | undefined {
    const cached = this.cache.get(path);
    if (!cached) return undefined;
    this.touch(path, cached);
    return cached.value;
  }

  enqueue(paths: readonly string[], onTitleChanged: (path: string) => void): void {
    for (const path of paths) {
      const callbacks = this.queuedCallbacks.get(path);
      if (callbacks) {
        callbacks.add(onTitleChanged);
        continue;
      }
      this.queuedCallbacks.set(path, new Set([onTitleChanged]));
      this.queue.push(path);
    }
    this.drain();
  }

  clear(): void {
    this.generation += 1;
    this.queue.length = 0;
    this.queuedCallbacks.clear();
    this.cache.clear();
  }

  private drain(): void {
    while (this.activeWorkers < MAX_BACKGROUND_WORKERS) {
      const path = this.queue.shift();
      if (!path) return;
      this.activeWorkers += 1;
      const generation = this.generation;
      void this.refreshQueued(path, generation).finally(() => {
        this.activeWorkers -= 1;
        this.drain();
      });
    }
  }

  private async refreshQueued(path: string, generation: number): Promise<void> {
    const previous = this.cache.get(path)?.value;
    const loaded = await this.load(path);
    if (generation !== this.generation) return;
    const callbacks = this.queuedCallbacks.get(path);
    this.queuedCallbacks.delete(path);
    if (!loaded) return;
    this.touch(path, loaded);
    if (loaded.value === undefined || loaded.value === previous) return;
    for (const callback of callbacks ?? []) callback(path);
  }

  private async load(path: string): Promise<CachedTitle | undefined> {
    const file = await stat(path, { bigint: true }).catch(() => undefined);
    if (!file?.isFile()) return undefined;
    const key = `${file.dev}:${file.ino}:${file.mtimeNs}:${file.size}`;
    const cached = this.cache.get(path);
    if (cached?.key === key) return cached;
    const value = await readLatestUserTitle(path, Number(file.size)).catch(() => undefined);
    return { key, value };
  }

  private touch(path: string, value: CachedTitle): void {
    this.cache.delete(path);
    this.cache.set(path, value);
    while (this.cache.size > this.maximumItems) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

async function readLatestUserTitle(path: string, size: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(size) || size <= 0) return undefined;
  const handle = await open(path, "r");
  let offset = size;
  const minimumOffset = Math.max(0, size - MAX_TAIL_BYTES);
  let suffix = Buffer.alloc(0);
  let targetId: string | null | undefined;
  try {
    while (offset > minimumOffset) {
      const length = Math.min(READ_CHUNK_BYTES, offset - minimumOffset);
      offset -= length;
      const buffer = Buffer.allocUnsafe(length);
      const read = await handle.read(buffer, 0, length, offset);
      if (read.bytesRead !== length) return undefined;
      const joined = Buffer.concat([buffer, suffix]);
      const firstNewline = joined.indexOf(0x0a);
      if (firstNewline === -1) {
        suffix = joined;
        if (suffix.byteLength > MAX_LINE_BYTES) return undefined;
        continue;
      }
      suffix = joined.subarray(0, firstNewline);
      const lines = joined.subarray(firstNewline + 1).toString("utf8").split("\n");
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const outcome = inspectLine(lines[index] ?? "", targetId);
        if (!outcome) continue;
        if (outcome.title !== undefined) return outcome.title;
        targetId = outcome.parentId;
        if (targetId === null) return undefined;
      }
      if (suffix.byteLength > MAX_LINE_BYTES) return undefined;
    }
    const outcome = inspectLine(suffix.toString("utf8"), targetId);
    return outcome?.title;
  } finally {
    await handle.close();
  }
}

function inspectLine(
  line: string,
  targetId: string | null | undefined
): { parentId: string | null; title?: string } | undefined {
  if (!line.trim()) return undefined;
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (entry.type === "session" || typeof entry.id !== "string") return undefined;
  if (targetId !== undefined && entry.id !== targetId) return undefined;
  const parentId = typeof entry.parentId === "string" ? entry.parentId : null;
  if (entry.type !== "message") return { parentId };
  const message = isRecord(entry.message) ? entry.message : undefined;
  if (message?.role !== "user") return { parentId };
  const { text, hasImage } = extractUserContent(message.content);
  const title = conversationTitleCandidate(text, hasImage);
  return title === undefined ? { parentId } : { parentId, title };
}

function extractUserContent(content: unknown): { text: string; hasImage: boolean } {
  if (typeof content === "string") return { text: content, hasImage: false };
  if (!Array.isArray(content)) return { text: "", hasImage: false };
  const text: string[] = [];
  let hasImage = false;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    if (block.type === "image" || block.type === "image_url") hasImage = true;
  }
  return { text: text.join(" "), hasImage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
