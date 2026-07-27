import assert from "node:assert/strict";
import {
  appendFile,
  mkdtemp,
  realpath,
  rename,
  rm,
  truncate,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  SessionJsonlWatcher,
  createSessionJsonlTailCursor,
  drainSessionJsonlTail
} from "../dist/performance/session-jsonl-tail-performance-entry.mjs";

const KIB = 1024;
const MIB = 1024 * KIB;
const DEFAULT_TAIL_LIMITS = Object.freeze({
  readChunkBytes: 256 * KIB,
  maxBytesPerDrain: 4 * MIB,
  maxLineBytes: 64 * MIB
});

export const SESSION_JSONL_TAIL_PERFORMANCE_WORKLOADS = Object.freeze({
  selfAppend1KiBLineBytes: 1 * KIB,
  selfAppend256KiBLineBytes: 256 * KIB,
  boundedDrainBytes: 4 * MIB,
  boundedDrainPassBytes: 1 * MIB,
  maxPhysicalLineBytes: 64 * MIB,
  sequentialRecordCount: 1_000
});

export async function runSessionJsonlTailPerformanceSample({ includeBoundary = false } = {}) {
  const root = await createTemporaryRoot();
  try {
    const result = {
      selfAppend1KiB: await measureSelfAppendAcceptance(
        join(root, "self-append-1-kib.jsonl"),
        SESSION_JSONL_TAIL_PERFORMANCE_WORKLOADS.selfAppend1KiBLineBytes
      ),
      selfAppend256KiB: await measureSelfAppendAcceptance(
        join(root, "self-append-256-kib.jsonl"),
        SESSION_JSONL_TAIL_PERFORMANCE_WORKLOADS.selfAppend256KiBLineBytes
      ),
      boundedDrain4MiB: await measureBoundedDrain(join(root, "bounded-drain-4-mib.jsonl"), {
        lineBytes: SESSION_JSONL_TAIL_PERFORMANCE_WORKLOADS.boundedDrainBytes - 1,
        maxBytesPerDrain: SESSION_JSONL_TAIL_PERFORMANCE_WORKLOADS.boundedDrainPassBytes
      }),
      sequentialSelfAppend1000: await measureSequentialSelfAppends(
        join(root, "sequential-self-append.jsonl"),
        SESSION_JSONL_TAIL_PERFORMANCE_WORKLOADS.sequentialRecordCount
      ),
      externalAppend: await measureExternalAppendDetection(join(root, "external-append.jsonl")),
      truncate: await measureTruncateDetection(join(root, "truncate.jsonl")),
      atomicReplace: await measureAtomicReplaceDetection(join(root, "atomic-replace.jsonl")),
      missingCreate: await measureMissingCreateAcceptance(join(root, "missing-create.jsonl")),
      generationDisposeRace: await measureGenerationDisposeRace(root)
    };
    if (includeBoundary) {
      result.boundary64MiB = await measureBoundedDrain(join(root, "boundary-64-mib.jsonl"), {
        lineBytes: SESSION_JSONL_TAIL_PERFORMANCE_WORKLOADS.maxPhysicalLineBytes,
        maxBytesPerDrain: DEFAULT_TAIL_LIMITS.maxBytesPerDrain
      });
    }
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function measureSelfAppendAcceptance(path, lineBytes) {
  const headerRecord = header(`self-${lineBytes}`);
  const expectedRecords = [headerRecord];
  await writeRecords(path, expectedRecords);
  const record = sizedRecord(`self-entry-${lineBytes}`, lineBytes);
  const line = serializeSizedRecord(record, lineBytes);
  const changes = [];
  const watcher = new SessionJsonlWatcher({ debounceMs: 60_000 });
  try {
    await watcher.bind(binding(path, expectedRecords, changes));
    await appendFile(path, line.bytes);
    expectedRecords.push(record);
    const startedAt = performance.now();
    await watcher.checkNow();
    const durationMs = performance.now() - startedAt;
    assert.deepEqual(changes, [], "A Pi-owned append must not be reported as external.");
    return {
      durationMs,
      bytesProcessed: line.bytes.byteLength,
      recordsProcessed: 1
    };
  } finally {
    watcher.dispose();
  }
}

async function measureBoundedDrain(path, { lineBytes, maxBytesPerDrain }) {
  await writeRecords(path, [header(`bounded-${lineBytes}`)]);
  const cursor = await createSessionJsonlTailCursor(path, DEFAULT_TAIL_LIMITS);
  const record = sizedRecord(`bounded-entry-${lineBytes}`, lineBytes);
  const line = serializeSizedRecord(record, lineBytes);
  await appendFile(path, line.bytes);

  const startedAt = performance.now();
  const drained = await drainAll(cursor, {
    ...DEFAULT_TAIL_LIMITS,
    maxBytesPerDrain
  });
  const durationMs = performance.now() - startedAt;

  assert.equal(drained.bytesProcessed, line.bytes.byteLength, "Bounded drain byte accounting drifted.");
  assert.equal(drained.records.length, 1, "Bounded drain must recover exactly one record.");
  assert.deepEqual(drained.records[0], record, "Bounded drain changed the parsed JSONL record.");
  return {
    durationMs,
    bytesProcessed: drained.bytesProcessed,
    recordsProcessed: drained.records.length,
    passCount: drained.passCount,
    peakPendingLineBytes: drained.peakPendingLineBytes,
    eventLoopYieldCount: drained.eventLoopYieldCount
  };
}

async function measureSequentialSelfAppends(path, recordCount) {
  const headerRecord = header("sequential");
  const expectedRecords = [headerRecord];
  await writeRecords(path, expectedRecords);
  const records = Array.from({ length: recordCount }, (_, index) => messageRecord(
    `sequential-${String(index).padStart(4, "0")}`,
    `Synthetic JSONL performance record ${index}.`
  ));
  const lines = records.map((record) => Buffer.from(`${JSON.stringify(record)}\n`, "utf8"));
  const changes = [];
  const watcher = new SessionJsonlWatcher({ debounceMs: 60_000 });
  let bytesProcessed = 0;
  try {
    await watcher.bind(binding(path, expectedRecords, changes));
    const startedAt = performance.now();
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const line = lines[index];
      assert.ok(record && line, "Sequential fixture index is out of range.");
      await appendFile(path, line);
      bytesProcessed += line.byteLength;
      expectedRecords.push(record);
      await watcher.checkNow();
    }
    const durationMs = performance.now() - startedAt;
    assert.deepEqual(changes, [], "Sequential Pi-owned appends must remain accepted.");
    return { durationMs, bytesProcessed, recordsProcessed: records.length };
  } finally {
    watcher.dispose();
  }
}

async function measureExternalAppendDetection(path) {
  const expectedRecords = [header("external")];
  await writeRecords(path, expectedRecords);
  const changes = [];
  const watcher = new SessionJsonlWatcher({ debounceMs: 60_000 });
  try {
    await watcher.bind(binding(path, expectedRecords, changes));
    const line = Buffer.from(`${JSON.stringify(messageRecord("external-entry", "External writer"))}\n`, "utf8");
    await appendFile(path, line);
    const startedAt = performance.now();
    await watcher.checkNow();
    const durationMs = performance.now() - startedAt;
    assert.deepEqual(changes, [{ reason: "appended", recoverable: true }]);
    return { durationMs, bytesProcessed: line.byteLength };
  } finally {
    watcher.dispose();
  }
}

async function measureTruncateDetection(path) {
  await writeRecords(path, [header("truncate")]);
  const cursor = await createSessionJsonlTailCursor(path);
  await truncate(path, 1);
  return measureConflict(cursor, "truncated");
}

async function measureAtomicReplaceDetection(path) {
  await writeRecords(path, [header("replace-before")]);
  const cursor = await createSessionJsonlTailCursor(path);
  const replacement = `${path}.replacement`;
  await writeRecords(replacement, [header("replace-after")]);
  await rename(replacement, path);
  return measureConflict(cursor, "replaced");
}

async function measureMissingCreateAcceptance(path) {
  const expectedRecords = [header("created-later"), messageRecord("created-entry", "Created later")];
  const changes = [];
  const watcher = new SessionJsonlWatcher({ debounceMs: 60_000 });
  try {
    await watcher.bind(binding(path, expectedRecords, changes));
    const bytes = Buffer.from(expectedRecords.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
    await writeFile(path, bytes);
    const startedAt = performance.now();
    await watcher.checkNow();
    const durationMs = performance.now() - startedAt;
    assert.deepEqual(changes, [], "A matching first Session file creation must be accepted.");
    return { durationMs, bytesProcessed: bytes.byteLength, recordsProcessed: expectedRecords.length };
  } finally {
    watcher.dispose();
  }
}

async function measureGenerationDisposeRace(root) {
  const firstPath = join(root, "race-first.jsonl");
  const secondPath = join(root, "race-second.jsonl");
  const firstRecords = [header("race-first")];
  const secondRecords = [header("race-second")];
  await Promise.all([writeRecords(firstPath, firstRecords), writeRecords(secondPath, secondRecords)]);
  const changes = [];
  const watcher = new SessionJsonlWatcher({ debounceMs: 0 });
  try {
    await watcher.bind({ ...binding(firstPath, firstRecords, changes), generation: 1 });
    const startedAt = performance.now();
    await watcher.bind({ ...binding(secondPath, secondRecords, changes), generation: 2 });
    await appendFile(firstPath, `${JSON.stringify(messageRecord("stale-entry", "Stale generation"))}\n`);
    await watcher.checkNow();
    watcher.dispose();
    await appendFile(secondPath, `${JSON.stringify(messageRecord("disposed-entry", "Disposed generation"))}\n`);
    await yieldToEventLoop();
    await yieldToEventLoop();
    const durationMs = performance.now() - startedAt;
    assert.deepEqual(changes, [], "Stale or disposed watcher generations must not report changes.");
    return { durationMs };
  } finally {
    watcher.dispose();
  }
}

async function measureConflict(cursor, expectedReason) {
  const startedAt = performance.now();
  const result = await drainSessionJsonlTail(cursor);
  const durationMs = performance.now() - startedAt;
  assert.equal(result.kind, "conflict", `Expected ${expectedReason} conflict, received ${result.kind}.`);
  assert.equal(result.reason, expectedReason, "Tail conflict reason drifted.");
  return { durationMs };
}

async function drainAll(initialCursor, limits) {
  let cursor = initialCursor;
  let bytesProcessed = 0;
  let passCount = 0;
  let peakPendingLineBytes = cursor.pendingLine.byteLength;
  let eventLoopYieldCount = 0;
  const records = [];
  while (true) {
    const result = await drainSessionJsonlTail(cursor, limits);
    assert.equal(result.kind, "appended", `Expected appended tail data, received ${result.kind}.`);
    bytesProcessed += result.appendedBytes;
    passCount += 1;
    records.push(...result.records);
    cursor = result.cursor;
    peakPendingLineBytes = Math.max(peakPendingLineBytes, cursor.pendingLine.byteLength);
    if (!result.more) break;
    eventLoopYieldCount += 1;
    await yieldToEventLoop();
  }
  assert.equal(cursor.pendingLine.byteLength, 0, "Completed benchmark append left a partial JSONL line.");
  return { bytesProcessed, passCount, peakPendingLineBytes, eventLoopYieldCount, records };
}

function binding(path, expectedRecords, changes) {
  return {
    path,
    generation: 1,
    getExpectedRecords: () => expectedRecords,
    onExternalChange: (change) => changes.push(change)
  };
}

async function createTemporaryRoot() {
  const created = await mkdtemp(join(tmpdir(), "pi67-session-jsonl-tail-performance-"));
  return realpath(created);
}

async function writeRecords(path, records) {
  await writeFile(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function serializeSizedRecord(record, expectedLineBytes) {
  const text = JSON.stringify(record);
  const lineBytes = Buffer.byteLength(text, "utf8");
  assert.equal(lineBytes, expectedLineBytes, "Synthetic JSONL line size is not exact.");
  return { bytes: Buffer.from(`${text}\n`, "utf8") };
}

function sizedRecord(id, lineBytes) {
  const prefix = `{"type":"message","id":${JSON.stringify(id)},"payload":"`;
  const suffix = `"}`;
  const fixedBytes = Buffer.byteLength(prefix + suffix, "utf8");
  assert.ok(lineBytes >= fixedBytes, `Requested JSONL line must be at least ${fixedBytes} bytes.`);
  return {
    type: "message",
    id,
    payload: "x".repeat(lineBytes - fixedBytes)
  };
}

function header(id) {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-07-25T00:00:00.000Z",
    cwd: "/synthetic-workspace"
  };
}

function messageRecord(id, text) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-07-25T00:00:01.000Z",
    message: { role: "user", content: text, timestamp: 1 }
  };
}

function yieldToEventLoop() {
  return new Promise((resolveYield) => setTimeout(resolveYield, 0));
}
