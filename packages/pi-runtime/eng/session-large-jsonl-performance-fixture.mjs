import assert from "node:assert/strict";
import { mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createSessionJsonlTailCursor,
  drainSessionJsonlTail
} from "../dist/performance/session-jsonl-tail-performance-entry.mjs";

const KIB = 1024;
const MIB = 1024 * KIB;
const WRITE_CHUNK_BYTES = 4 * MIB;
const TAIL_LIMITS = Object.freeze({
  readChunkBytes: 256 * KIB,
  maxBytesPerDrain: 4 * MIB,
  maxLineBytes: 64 * MIB
});

export async function runLargeSessionJsonlPerformanceSample(workload) {
  validateWorkload(workload);
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi67-large-session-jsonl-")));
  const path = join(root, "large-session.jsonl");
  try {
    await writeFile(path, `${JSON.stringify(header(workload.id))}\n`, { mode: 0o600 });
    const cursor = await createSessionJsonlTailCursor(path, TAIL_LIMITS);
    const fixture = await appendSyntheticRecords(path, workload);
    const startedAt = performance.now();
    const drained = await drainLargeAppend(cursor);
    const durationMs = performance.now() - startedAt;

    assert.equal(drained.bytesProcessed, workload.totalBytes, "Large JSONL drain byte accounting drifted.");
    assert.equal(drained.recordsProcessed, workload.recordCount, "Large JSONL record count drifted.");
    assert.equal(drained.firstId, recordId(0), "Large JSONL first record identity drifted.");
    assert.equal(
      drained.lastId,
      recordId(workload.recordCount - 1),
      "Large JSONL last record identity drifted."
    );
    assert.equal(drained.eventLoopYieldCount, drained.passCount - 1);

    return {
      durationMs,
      fixtureWriteMs: fixture.durationMs,
      bytesProcessed: drained.bytesProcessed,
      recordsProcessed: drained.recordsProcessed,
      passCount: drained.passCount,
      peakPendingLineBytes: drained.peakPendingLineBytes,
      eventLoopYieldCount: drained.eventLoopYieldCount
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function appendSyntheticRecords(path, workload) {
  const baseLineBytes = Math.floor(workload.totalBytes / workload.recordCount);
  const remainder = workload.totalBytes % workload.recordCount;
  const handle = await open(path, "a", 0o600);
  let chunks = [];
  let chunkBytes = 0;
  const startedAt = performance.now();
  try {
    for (let index = 0; index < workload.recordCount; index += 1) {
      const targetBytes = baseLineBytes + (index < remainder ? 1 : 0);
      const line = sizedRecordLine(index, targetBytes);
      chunks.push(line);
      chunkBytes += line.byteLength;
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
  return { durationMs: performance.now() - startedAt };
}

async function drainLargeAppend(initialCursor) {
  let cursor = initialCursor;
  let bytesProcessed = 0;
  let recordsProcessed = 0;
  let passCount = 0;
  let peakPendingLineBytes = cursor.pendingLine.byteLength;
  let eventLoopYieldCount = 0;
  let firstId;
  let lastId;
  while (true) {
    const result = await drainSessionJsonlTail(cursor, TAIL_LIMITS);
    assert.equal(result.kind, "appended", `Expected appended tail data, received ${result.kind}.`);
    bytesProcessed += result.appendedBytes;
    passCount += 1;
    for (const record of result.records) {
      assert.equal(record.type, "message", "Large JSONL fixture returned a non-message record.");
      assert.equal(typeof record.id, "string", "Large JSONL fixture returned an invalid record id.");
      firstId ??= record.id;
      lastId = record.id;
      recordsProcessed += 1;
    }
    cursor = result.cursor;
    peakPendingLineBytes = Math.max(peakPendingLineBytes, cursor.pendingLine.byteLength);
    if (!result.more) break;
    eventLoopYieldCount += 1;
    await yieldToEventLoop();
  }
  assert.equal(cursor.pendingLine.byteLength, 0, "Large JSONL drain left a partial physical line.");
  return {
    bytesProcessed,
    recordsProcessed,
    passCount,
    peakPendingLineBytes,
    eventLoopYieldCount,
    firstId,
    lastId
  };
}

function sizedRecordLine(index, targetBytes) {
  const id = recordId(index);
  const prefix = `{"type":"message","id":${JSON.stringify(id)},"payload":"`;
  const suffix = `"}\n`;
  const fixedBytes = Buffer.byteLength(prefix + suffix, "utf8");
  assert.ok(targetBytes >= fixedBytes, "Large JSONL workload line is too small for its record envelope.");
  const line = Buffer.from(`${prefix}${"x".repeat(targetBytes - fixedBytes)}${suffix}`, "utf8");
  assert.equal(line.byteLength, targetBytes, "Large JSONL fixture line size drifted.");
  return line;
}

function recordId(index) {
  return `large-${String(index).padStart(6, "0")}`;
}

function header(id) {
  return {
    type: "session",
    version: 3,
    id: `large-session-${id}`,
    timestamp: "2026-08-07T00:00:00.000Z",
    cwd: "/synthetic-workspace"
  };
}

function validateWorkload(workload) {
  if (!workload || typeof workload.id !== "string" || workload.id.length === 0
    || !Number.isSafeInteger(workload.totalBytes) || workload.totalBytes < 1
    || !Number.isSafeInteger(workload.recordCount) || workload.recordCount < 1) {
    throw new Error("Large Session JSONL workload is invalid.");
  }
}

function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
