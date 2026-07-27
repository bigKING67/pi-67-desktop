import { appendFile, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SessionJsonlWatcher,
  type SessionJsonlExternalChange
} from "./session-jsonl-watcher.js";

const temporaryDirectories: string[] = [];
const watchers: SessionJsonlWatcher[] = [];

afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.dispose();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SessionJsonlWatcher", () => {
  it("accepts only new records already owned by the active Pi Session", async () => {
    const { path, records } = await createSessionFile();
    const onExternalChange = vi.fn<(change: SessionJsonlExternalChange) => void>();
    const watcher = createWatcher();
    await watcher.bind(binding(path, 1, records, onExternalChange));
    const selfEntry = { ...entry("self-entry", "Desktop write"), optionalDetails: undefined };

    await appendFile(path, `${JSON.stringify(selfEntry)}\n`);
    records.push(selfEntry);
    await watcher.checkNow();

    expect(onExternalChange).not.toHaveBeenCalled();
  });

  it("reports an external append once even when dirty events are duplicated", async () => {
    const { path, records } = await createSessionFile();
    const onExternalChange = vi.fn<(change: SessionJsonlExternalChange) => void>();
    const watcher = createWatcher();
    await watcher.bind(binding(path, 1, records, onExternalChange));

    await appendFile(path, `${JSON.stringify(entry("external-entry", "TUI write"))}\n`);
    await watcher.checkNow();
    await watcher.checkNow();

    expect(onExternalChange).toHaveBeenCalledTimes(1);
    expect(onExternalChange).toHaveBeenCalledWith({ reason: "appended", recoverable: true });
  });

  it("accepts the first complete file creation when it matches the SessionManager state", async () => {
    const root = await createTemporaryDirectory();
    const path = join(root, "created-after-bind.jsonl");
    const records = [header("created-after-bind"), entry("first-entry", "Initial turn")];
    const onExternalChange = vi.fn<(change: SessionJsonlExternalChange) => void>();
    const watcher = createWatcher({ readChunkBytes: 3, maxBytesPerDrain: 11 });
    await watcher.bind(binding(path, 1, records, onExternalChange));

    await writeFile(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    await watcher.checkNow();

    expect(onExternalChange).not.toHaveBeenCalled();
  });

  it("fails closed for blank, malformed and incomplete external appends", async () => {
    const blank = await observeExternalBytes("  \n");
    expect(blank).toEqual({ reason: "appended", recoverable: true });

    const malformed = await observeExternalBytes("{not-json}\n");
    expect(malformed).toEqual({ reason: "invalid", recoverable: false });

    const incomplete = await observeExternalBytes(JSON.stringify(entry("partial", "unfinished")));
    expect(incomplete).toEqual({ reason: "invalid", recoverable: false });
  });

  it("drains a large self record across bounded passes without false detection", async () => {
    const { path, records } = await createSessionFile();
    const onExternalChange = vi.fn<(change: SessionJsonlExternalChange) => void>();
    const watcher = createWatcher({
      readChunkBytes: 2,
      maxBytesPerDrain: 13,
      maxLineBytes: 2_048,
      maxDrainPasses: 64
    });
    await watcher.bind(binding(path, 1, records, onExternalChange));
    const selfEntry = entry("large-self-entry", "跨块".repeat(80));

    await appendFile(path, `${JSON.stringify(selfEntry)}\n`);
    records.push(selfEntry);
    await watcher.checkNow();

    expect(onExternalChange).not.toHaveBeenCalled();
  });

  it("invalidates callbacks from the previous Session generation", async () => {
    const first = await createSessionFile("first.jsonl", "first-session");
    const second = await createSessionFile("second.jsonl", "second-session");
    const firstChange = vi.fn<(change: SessionJsonlExternalChange) => void>();
    const secondChange = vi.fn<(change: SessionJsonlExternalChange) => void>();
    const watcher = createWatcher({ debounceMs: 5 });
    await watcher.bind(binding(first.path, 1, first.records, firstChange));
    await watcher.bind(binding(second.path, 2, second.records, secondChange));

    await appendFile(first.path, `${JSON.stringify(entry("stale", "Old Session"))}\n`);
    await delay(20);
    await watcher.checkNow();
    expect(firstChange).not.toHaveBeenCalled();
    expect(secondChange).not.toHaveBeenCalled();

    await appendFile(second.path, `${JSON.stringify(entry("current", "Current Session"))}\n`);
    await watcher.checkNow();
    expect(secondChange).toHaveBeenCalledWith({ reason: "appended", recoverable: true });
  });

  it("drops late fs.watch callbacks after disposal", async () => {
    const { path, records } = await createSessionFile();
    const onExternalChange = vi.fn<(change: SessionJsonlExternalChange) => void>();
    const watcher = createWatcher({ debounceMs: 10 });
    await watcher.bind(binding(path, 1, records, onExternalChange));

    await appendFile(path, `${JSON.stringify(entry("late", "Late callback"))}\n`);
    watcher.dispose();
    await delay(30);

    expect(onExternalChange).not.toHaveBeenCalled();
  });

  it("bounds one authoritative check instead of draining an unlimited producer", async () => {
    const { path, records } = await createSessionFile();
    const onExternalChange = vi.fn<(change: SessionJsonlExternalChange) => void>();
    const watcher = createWatcher({
      readChunkBytes: 4,
      maxBytesPerDrain: 8,
      maxLineBytes: 1_024,
      maxDrainPasses: 1
    });
    await watcher.bind(binding(path, 1, records, onExternalChange));
    const selfEntry = entry("bounded", "x".repeat(100));

    await appendFile(path, `${JSON.stringify(selfEntry)}\n`);
    records.push(selfEntry);
    await watcher.checkNow();

    expect(onExternalChange).toHaveBeenCalledWith({ reason: "invalid", recoverable: false });
  });
});

function createWatcher(options: ConstructorParameters<typeof SessionJsonlWatcher>[0] = {}): SessionJsonlWatcher {
  const watcher = new SessionJsonlWatcher({ debounceMs: 60_000, ...options });
  watchers.push(watcher);
  return watcher;
}

function binding(
  path: string,
  generation: number,
  records: Array<Record<string, unknown>>,
  onExternalChange: (change: SessionJsonlExternalChange) => void
) {
  return {
    path,
    generation,
    getExpectedRecords: () => records,
    onExternalChange
  };
}

async function observeExternalBytes(bytes: string): Promise<SessionJsonlExternalChange | undefined> {
  const { path, records } = await createSessionFile();
  let change: SessionJsonlExternalChange | undefined;
  const watcher = createWatcher();
  await watcher.bind(binding(path, 1, records, (next) => { change = next; }));
  await appendFile(path, bytes);
  await watcher.checkNow();
  return change;
}

async function createSessionFile(name = "session.jsonl", id = "session-1") {
  const root = await createTemporaryDirectory();
  const path = join(root, name);
  const records = [header(id)];
  await writeFile(path, `${JSON.stringify(records[0])}\n`);
  return { path, records };
}

async function createTemporaryDirectory(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), "pi67-jsonl-watcher-"));
  const canonical = await realpath(created);
  temporaryDirectories.push(canonical);
  return canonical;
}

function header(id: string): Record<string, unknown> {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-07-25T00:00:00.000Z",
    cwd: "/workspace"
  };
}

function entry(id: string, text: string): Record<string, unknown> {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-07-25T00:00:01.000Z",
    message: { role: "user", content: text, timestamp: 1 }
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
