import assert from "node:assert/strict";
import { open, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  SessionProjectionIndex,
  projectMessagePage
} from "../dist/index.mjs";

const FIXTURE_LINE_BYTES = 4 * 1024;
const WRITE_CHUNK_BYTES = 4 * 1024 * 1024;
const FIXTURE_TIMESTAMP = "2026-08-28T00:00:00.000Z";

export async function writeSyntheticSessionOpenFixture({ path, cwd, targetBytes }) {
  if (!path || !cwd || !Number.isSafeInteger(targetBytes) || targetBytes < FIXTURE_LINE_BYTES) {
    throw new Error("Session-open fixture requires path, cwd, and a target of at least 4 KiB.");
  }
  const header = Buffer.from(`${JSON.stringify({
    type: "session",
    version: 3,
    id: `session-open-${targetBytes}`,
    timestamp: FIXTURE_TIMESTAMP,
    cwd
  })}\n`, "utf8");
  const handle = await open(path, "w", 0o600);
  let writtenBytes = header.byteLength;
  let messageCount = 0;
  let parentId = null;
  let chunks = [header];
  let chunkBytes = header.byteLength;
  const startedAt = performance.now();
  try {
    while (writtenBytes < targetBytes) {
      const id = messageId(messageCount);
      const line = sizedMessageLine({
        id,
        parentId,
        index: messageCount,
        targetBytes: FIXTURE_LINE_BYTES
      });
      chunks.push(line);
      chunkBytes += line.byteLength;
      writtenBytes += line.byteLength;
      messageCount += 1;
      parentId = id;
      if (chunkBytes >= WRITE_CHUNK_BYTES) {
        await handle.writeFile(Buffer.concat(chunks, chunkBytes));
        chunks = [];
        chunkBytes = 0;
      }
    }
    if (chunkBytes > 0) await handle.writeFile(Buffer.concat(chunks, chunkBytes));
    await handle.sync();
  } finally {
    await handle.close();
  }
  const byteLength = (await stat(path)).size;
  assert.equal(byteLength, writtenBytes, "Session-open fixture byte accounting drifted.");
  return {
    path,
    cwd,
    targetBytes,
    byteLength,
    messageCount,
    fixtureWriteMs: performance.now() - startedAt
  };
}

export async function measureSessionOpenPerformanceSample({
  sessionPath,
  cwd,
  expectedMessageCount
}) {
  if (!sessionPath || !cwd || !Number.isSafeInteger(expectedMessageCount) || expectedMessageCount < 1) {
    throw new Error("Session-open sample requires a path, cwd, and expected message count.");
  }
  global.gc?.();
  const memoryBefore = process.memoryUsage();
  const loopScheduledAt = performance.now();
  const eventLoopDelay = new Promise((resolve) => {
    setImmediate(() => resolve(performance.now() - loopScheduledAt));
  });

  const openStartedAt = performance.now();
  const manager = SessionManager.open(sessionPath, undefined, cwd);
  const openMs = performance.now() - openStartedAt;
  const eventLoopDelayMs = await eventLoopDelay;

  const projection = new SessionProjectionIndex();
  const projectionStartedAt = performance.now();
  projection.bind(manager);
  const projectionBindMs = performance.now() - projectionStartedAt;

  const firstPageStartedAt = performance.now();
  const firstPage = projectMessagePage(projection);
  const firstPageMs = performance.now() - firstPageStartedAt;
  const metadata = projection.getMetadata(manager);
  assert.equal(metadata.messageCount, expectedMessageCount, "Opened Session message count drifted.");
  assert.ok(firstPage.messages.length > 0, "Opened Session first page is empty.");

  const userMessagePageStartedAt = performance.now();
  const userMessageCount = projection.getUserMessageCount();
  const userMessagePage = projection.getUserMessages(Math.max(0, userMessageCount - 100), 100);
  const userMessagePageMs = performance.now() - userMessagePageStartedAt;
  assert.equal(userMessageCount, expectedMessageCount, "Opened Session user-message count drifted.");
  assert.equal(userMessagePage.length, Math.min(100, expectedMessageCount), "User-message page size drifted.");

  globalThis.__pi67SessionOpenPerformanceHold = { manager, projection, firstPage, userMessagePage };
  global.gc?.();
  const memoryAfter = process.memoryUsage();
  return {
    openMs,
    eventLoopDelayMs,
    projectionBindMs,
    firstPageMs,
    userMessagePageMs,
    retainedRssBytes: Math.max(0, memoryAfter.rss - memoryBefore.rss),
    retainedHeapBytes: Math.max(0, memoryAfter.heapUsed - memoryBefore.heapUsed),
    messageCount: metadata.messageCount,
    firstPageBytes: Buffer.byteLength(JSON.stringify(firstPage), "utf8"),
    userMessagePageBytes: Buffer.byteLength(JSON.stringify(userMessagePage), "utf8")
  };
}

function sizedMessageLine({ id, parentId, index, targetBytes }) {
  const entry = {
    type: "message",
    id,
    parentId,
    timestamp: FIXTURE_TIMESTAMP,
    message: {
      role: "user",
      content: "",
      timestamp: 1_777_334_400_000 + index
    }
  };
  const empty = `${JSON.stringify(entry)}\n`;
  const fixedBytes = Buffer.byteLength(empty, "utf8");
  assert.ok(fixedBytes <= targetBytes, "Session-open fixture envelope exceeded its line budget.");
  entry.message.content = `Synthetic Pi-67 Session-open fixture ${index}: ${"x".repeat(
    targetBytes - fixedBytes - Buffer.byteLength(`Synthetic Pi-67 Session-open fixture ${index}: `, "utf8")
  )}`;
  const line = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
  assert.equal(line.byteLength, targetBytes, "Session-open fixture line size drifted.");
  return line;
}

function messageId(index) {
  return `message-${String(index).padStart(12, "0")}`;
}
