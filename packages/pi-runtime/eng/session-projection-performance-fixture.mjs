import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MESSAGE_PAGE_SIZE,
  MAX_MESSAGE_PAGE_SIZE,
  SessionProjectionIndex,
  projectMessagePage,
  projectSessionTree
} from "../dist/index.mjs";

const ZERO_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })
});

export const SESSION_PROJECTION_SIZES = Object.freeze({ small: 1_000, large: 10_000 });

export function createSessionProjectionFixture(messageCount) {
  if (!Number.isInteger(messageCount) || messageCount < 1) throw new Error("messageCount must be a positive integer.");
  const manager = SessionManager.inMemory("/tmp/pi67-session-projection", {
    id: `session-projection-${messageCount}`
  });
  const timestamp = Date.now();
  for (let index = 0; index < messageCount; index += 1) {
    manager.appendMessage(index % 2 === 0
      ? { role: "user", content: `Projection fixture user message ${index}.`, timestamp: timestamp + index }
      : {
          role: "assistant",
          content: [{ type: "text", text: `Projection fixture assistant message ${index}.` }],
          api: "openai-responses",
          provider: "pi67-performance",
          model: "fixture",
          usage: ZERO_USAGE,
          stopReason: "stop",
          timestamp: timestamp + index
        });
  }

  let entryScans = 0;
  const readEntries = manager.getEntries.bind(manager);
  manager.getEntries = () => {
    entryScans += 1;
    return readEntries();
  };
  return { manager, messageCount, getEntryScanCount: () => entryScans };
}

export function measureSessionProjection(fixture) {
  const scansBefore = fixture.getEntryScanCount();
  const projection = new SessionProjectionIndex();
  const bindStartedAt = performance.now();
  projection.bind(fixture.manager);
  const bindMs = performance.now() - bindStartedAt;

  const bootstrapStartedAt = performance.now();
  const recent = projectMessagePage(projection);
  const tree = projectSessionTree(projection);
  const bootstrapMs = performance.now() - bootstrapStartedAt;

  assert.equal(recent.messages.length, Math.min(DEFAULT_MESSAGE_PAGE_SIZE, fixture.messageCount));
  assert.equal(tree.total, fixture.messageCount);
  assert.ok(tree.nodes.length <= 512, "Tree projection exceeded its bounded node window.");
  assert.ok(recent.startCursor, "Recent page must expose a stable start cursor.");

  const olderStartedAt = performance.now();
  const older = projectMessagePage(projection, {
    direction: "older",
    cursor: recent.startCursor,
    limit: MAX_MESSAGE_PAGE_SIZE
  });
  const olderPageMs = performance.now() - olderStartedAt;
  if (fixture.messageCount > DEFAULT_MESSAGE_PAGE_SIZE) {
    assert.ok(older.messages.length > 0, "Older page must contain earlier messages.");
    const recentIds = new Set(recent.messages.map((message) => message.id));
    assert.equal(older.messages.some((message) => recentIds.has(message.id)), false, "Message pages overlap.");
  }

  const entryScans = fixture.getEntryScanCount() - scansBefore;
  assert.equal(entryScans, 1, "One projection bind must perform exactly one full SDK entry read.");
  return {
    bindMs,
    bootstrapMs,
    olderPageMs,
    entryScans,
    recentPageBytes: Buffer.byteLength(JSON.stringify(recent), "utf8")
  };
}
