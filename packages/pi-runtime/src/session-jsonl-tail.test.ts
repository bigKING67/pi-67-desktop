import {
  appendFile,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSessionJsonlTailCursor,
  drainSessionJsonlTail
} from "./session-jsonl-tail.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Session JSONL tail", () => {
  it("parses complete LF and CRLF appends without rescanning the baseline", async () => {
    const path = await createSessionFile();
    const cursor = await createSessionJsonlTailCursor(path);
    await appendFile(path, `${JSON.stringify(entry("entry-lf", "hello"))}\n${JSON.stringify(entry("entry-crlf", "世界"))}\r\n`);

    const result = await drainSessionJsonlTail(cursor);

    expect(result).toMatchObject({
      kind: "appended",
      physicalLineCount: 2,
      ignoredLineCount: 0,
      more: false,
      records: [entry("entry-lf", "hello"), entry("entry-crlf", "世界")]
    });
  });

  it("preserves a JSON record and split UTF-8 code point across bounded drains", async () => {
    const path = await createSessionFile();
    let cursor = await createSessionJsonlTailCursor(path);
    await appendFile(path, `${JSON.stringify(entry("entry-split", "跨块读取"))}\n`);
    const limits = { readChunkBytes: 1, maxBytesPerDrain: 7, maxLineBytes: 256 };

    const first = await drainSessionJsonlTail(cursor, limits);
    expect(first).toMatchObject({ kind: "appended", records: [], more: true });
    if (first.kind !== "appended") throw new Error("Expected the first bounded append.");
    expect(first.cursor.pendingLine.byteLength).toBe(7);
    cursor = first.cursor;

    const records: Array<Record<string, unknown>> = [];
    while (true) {
      const result = await drainSessionJsonlTail(cursor, limits);
      if (result.kind !== "appended") throw new Error(`Unexpected tail result: ${result.kind}`);
      records.push(...result.records);
      cursor = result.cursor;
      if (!result.more) break;
    }
    expect(records).toEqual([entry("entry-split", "跨块读取")]);
    expect(cursor.pendingLine.byteLength).toBe(0);
  });

  it("enforces physical-line and UTF-8 validity", async () => {
    const path = await createSessionFile();
    const lineCursor = await createSessionJsonlTailCursor(path);
    await appendFile(path, `${JSON.stringify(entry("entry-large", "x".repeat(80)))}\n`);
    await expect(drainSessionJsonlTail(lineCursor, {
      readChunkBytes: 128,
      maxBytesPerDrain: 128,
      maxLineBytes: 32
    })).resolves.toMatchObject({ kind: "conflict", reason: "invalid", recoverable: false });

    const invalidUtf8Path = await createSessionFile("invalid-utf8.jsonl");
    const utf8Cursor = await createSessionJsonlTailCursor(invalidUtf8Path);
    await appendFile(invalidUtf8Path, Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d, 0x0a]));
    await expect(drainSessionJsonlTail(utf8Cursor)).resolves.toMatchObject({
      kind: "conflict",
      reason: "invalid",
      recoverable: false
    });
  });

  it("reports malformed records and preserves blank-line accounting", async () => {
    const path = await createSessionFile();
    const malformedCursor = await createSessionJsonlTailCursor(path);
    await appendFile(path, "{not-json}\n");
    await expect(drainSessionJsonlTail(malformedCursor)).resolves.toMatchObject({
      kind: "conflict",
      reason: "invalid"
    });

    const blankPath = await createSessionFile("blank.jsonl");
    const blankCursor = await createSessionJsonlTailCursor(blankPath);
    await appendFile(blankPath, "  \n");
    await expect(drainSessionJsonlTail(blankCursor)).resolves.toMatchObject({
      kind: "appended",
      physicalLineCount: 1,
      ignoredLineCount: 1,
      records: []
    });
  });

  it("detects truncate, same-size mutation and atomic replacement", async () => {
    const truncatePath = await createSessionFile("truncate.jsonl");
    const truncateCursor = await createSessionJsonlTailCursor(truncatePath);
    await truncate(truncatePath, 1);
    await expect(drainSessionJsonlTail(truncateCursor)).resolves.toMatchObject({
      kind: "conflict",
      reason: "truncated"
    });

    const touchedPath = await createSessionFile("touched.jsonl");
    const touchedCursor = await createSessionJsonlTailCursor(touchedPath);
    const changedAt = new Date(Date.now() + 5_000);
    await utimes(touchedPath, changedAt, changedAt);
    await expect(drainSessionJsonlTail(touchedCursor)).resolves.toMatchObject({
      kind: "conflict",
      reason: "replaced"
    });

    const replacedPath = await createSessionFile("replaced.jsonl");
    const replacedCursor = await createSessionJsonlTailCursor(replacedPath);
    const replacement = join(await realpath(join(replacedPath, "..")), "replacement.jsonl");
    await writeFile(replacement, `${JSON.stringify(header("replacement"))}\n`);
    await rename(replacement, replacedPath);
    await expect(drainSessionJsonlTail(replacedCursor)).resolves.toMatchObject({
      kind: "conflict",
      reason: "replaced"
    });
  });

  it("distinguishes deletion from a valid first creation", async () => {
    const path = await createSessionFile();
    const existingCursor = await createSessionJsonlTailCursor(path);
    await rm(path);
    await expect(drainSessionJsonlTail(existingCursor)).resolves.toMatchObject({
      kind: "conflict",
      reason: "unavailable"
    });

    const missingPath = join(await createTemporaryDirectory(), "created-later.jsonl");
    const missingCursor = await createSessionJsonlTailCursor(missingPath);
    await writeFile(missingPath, `${JSON.stringify(header("created-later"))}\n`);
    await expect(drainSessionJsonlTail(missingCursor)).resolves.toMatchObject({
      kind: "appended",
      records: [header("created-later")]
    });
  });

  it("rejects a symlinked active Session path", async () => {
    const target = await createSessionFile("target.jsonl");
    const link = join(await realpath(join(target, "..")), "linked.jsonl");
    await symlink(target, link);

    await expect(createSessionJsonlTailCursor(link)).rejects.toMatchObject({
      reason: "invalid",
      recoverable: false
    });
  });

  it("validates custom limits before reading", async () => {
    const path = await createSessionFile();
    const cursor = await createSessionJsonlTailCursor(path);

    await expect(drainSessionJsonlTail(cursor, { maxBytesPerDrain: 0 })).rejects.toThrow(
      "maxBytesPerDrain must be a positive safe integer."
    );
  });
});

async function createSessionFile(name = "session.jsonl"): Promise<string> {
  const root = await createTemporaryDirectory();
  const path = join(root, name);
  await writeFile(path, `${JSON.stringify(header("session-1"))}\n`);
  return path;
}

async function createTemporaryDirectory(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), "pi67-jsonl-tail-"));
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
