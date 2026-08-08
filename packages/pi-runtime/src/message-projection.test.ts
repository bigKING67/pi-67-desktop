import { SessionManager } from "@earendil-works/pi-coding-agent";
import { MAX_CONVERSATION_PAGE_JSON_BYTES } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_PAGE_SIZE,
  projectMessagePage
} from "./message-projection.js";
import {
  PLAN_DECISION_ENTRY_TYPE,
  PROPOSED_PLAN_ENTRY_TYPE
} from "./plan-mode-controller.js";

describe("projectMessagePage", () => {
  it("projects Plan proposals in branch order and resolves their historical status", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "plan-timeline-session" });
    manager.appendMessage({ role: "user", content: "Prepare a plan", timestamp: 1 });
    manager.appendCustomEntry(PROPOSED_PLAN_ENTRY_TYPE, proposedPlan("plan-1", 2));
    manager.appendMessage(assistantText("Plan refined", 3));
    manager.appendCustomEntry(PROPOSED_PLAN_ENTRY_TYPE, proposedPlan("plan-2", 4));
    manager.appendCustomEntry(PLAN_DECISION_ENTRY_TYPE, {
      planId: "plan-2",
      decision: "implement",
      decidedAt: 5
    });
    manager.appendCustomEntry(PROPOSED_PLAN_ENTRY_TYPE, proposedPlan("plan-3", 6));
    manager.appendCustomEntry(PLAN_DECISION_ENTRY_TYPE, {
      planId: "plan-3",
      decision: "dismissed",
      decidedAt: 7
    });

    const page = projectMessagePage(manager);
    const proposals = page.messages.flatMap((message) => message.parts.flatMap((part) => (
      part.type === "plan-proposal" ? [part.plan] : []
    )));

    expect(page.messages.map((message) => message.role)).toEqual([
      "user",
      "system",
      "assistant",
      "system",
      "system"
    ]);
    expect(proposals.map((plan) => ({ planId: plan.planId, status: plan.status }))).toEqual([
      { planId: "plan-1", status: "dismissed" },
      { planId: "plan-2", status: "implemented" },
      { planId: "plan-3", status: "dismissed" }
    ]);
  });

  it("uses a Plan proposal as a valid page cursor without rendering decision records", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "plan-cursor-session" });
    manager.appendMessage({ role: "user", content: "Before", timestamp: 1 });
    const planEntryId = manager.appendCustomEntry(
      PROPOSED_PLAN_ENTRY_TYPE,
      proposedPlan("plan-cursor", 2)
    );
    manager.appendCustomEntry(PLAN_DECISION_ENTRY_TYPE, {
      planId: "plan-cursor",
      decision: "implement",
      decidedAt: 3
    });
    manager.appendMessage(assistantText("After", 4));

    const older = projectMessagePage(manager, { direction: "older", cursor: planEntryId, limit: 10 });
    const newer = projectMessagePage(manager, { direction: "newer", cursor: planEntryId, limit: 10 });

    expect(older.messages.map((message) => message.parts[0])).toEqual([
      { type: "text", text: "Before" }
    ]);
    expect(newer.messages.map((message) => message.parts[0])).toEqual([
      { type: "text", text: "After" }
    ]);
  });

  it("bootstraps only the newest 100 messages and pages older history without overlap", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "projection-session" });
    const entryIds: string[] = [];
    for (let index = 0; index < 10_000; index += 1) {
      entryIds.push(manager.appendMessage({
        role: "user",
        content: `Message ${index}`,
        timestamp: index
      }));
    }

    const recent = projectMessagePage(manager);
    expect(recent.messages).toHaveLength(100);
    expect(recent.messages[0]?.id).toBe(entryIds[9_900]);
    expect(recent.messages.at(-1)?.id).toBe(entryIds[9_999]);
    expect(recent).toMatchObject({ hasOlder: true, hasNewer: false });

    const older = projectMessagePage(manager, { direction: "older", cursor: recent.startCursor!, limit: 100 });
    expect(older.messages).toHaveLength(100);
    expect(older.messages[0]?.id).toBe(entryIds[9_800]);
    expect(older.messages.at(-1)?.id).toBe(entryIds[9_899]);
    expect(new Set([...older.messages, ...recent.messages].map((message) => message.id)).size).toBe(200);
    expect(older).toMatchObject({ hasOlder: true, hasNewer: true });

    const newer = projectMessagePage(manager, { direction: "newer", cursor: older.endCursor!, limit: 100 });
    expect(newer.messages.map((message) => message.id)).toEqual(recent.messages.map((message) => message.id));
  });

  it("bounds direct callers and rejects stale cursors", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "bounded-session" });
    for (let index = 0; index < 500; index += 1) {
      manager.appendMessage({ role: "user", content: `Message ${index}`, timestamp: index });
    }

    expect(projectMessagePage(manager, { direction: "older", limit: 10_000 }).messages)
      .toHaveLength(MAX_MESSAGE_PAGE_SIZE);
    expect(() => projectMessagePage(manager, { direction: "older", cursor: "missing" }))
      .toThrow("cursor does not exist");
  });

  it("uses Pi session entry IDs instead of array positions", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "stable-id-session" });
    const firstId = manager.appendMessage({ role: "user", content: "Same", timestamp: 1 });
    const secondId = manager.appendMessage({ role: "user", content: "Same", timestamp: 1 });

    const page = projectMessagePage(manager);
    expect(page.messages.map((message) => message.id)).toEqual([firstId, secondId]);
    expect(firstId).not.toBe(secondId);
  });

  it("reduces page count when visible message content would exceed the transport budget", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "byte-budget-session" });
    for (let index = 0; index < 100; index += 1) {
      manager.appendMessage({ role: "user", content: `${index}:${"x".repeat(64 * 1024)}`, timestamp: index });
    }

    const page = projectMessagePage(manager);
    expect(page.messages.length).toBeGreaterThan(0);
    expect(page.messages.length).toBeLessThan(100);
    expect(page.hasOlder).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(MAX_CONVERSATION_PAGE_JSON_BYTES);
  });

  it("uses the generation-scoped toolCallId resolver without guessing from tool names", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "adapter-session" });
    manager.appendMessage({
      role: "assistant",
      content: [
        { type: "toolCall", id: "adapted-call", name: "same_name", arguments: {} },
        { type: "toolCall", id: "historical-call", name: "same_name", arguments: {} }
      ],
      api: "openai-responses",
      provider: "fixture",
      model: "fixture",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "stop",
      timestamp: 1
    });

    const page = projectMessagePage(manager, {}, (toolCallId) => toolCallId === "adapted-call" ? ({
      adapterId: "verified",
      package: "@verified/example",
      presentation: "generic"
    }) : undefined);

    expect(page.messages[0]?.parts[0]).toHaveProperty("adapter.package", "@verified/example");
    expect(page.messages[0]?.parts[1]).not.toHaveProperty("adapter");
  });

  it("replaces image base64 with a generation-bound asset reference", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "asset-session" });
    const base64 = Buffer.from([1, 2, 3]).toString("base64");
    const entryId = manager.appendMessage({
      role: "user",
      content: [{ type: "image", mimeType: "image/png", data: base64 }],
      timestamp: 1
    });
    const sources: unknown[] = [];

    const page = projectMessagePage(manager, {}, undefined, (source) => {
      sources.push(source);
      return { id: "asset-1", byteLength: 3, sessionGeneration: 6 };
    });

    expect(sources).toEqual([{
      stableKey: `${entryId}:image:0`,
      mimeType: "image/png",
      base64
    }]);
    expect(page.messages[0]?.parts[0]).toEqual({
      type: "image",
      mimeType: "image/png",
      asset: { id: "asset-1", byteLength: 3, sessionGeneration: 6 }
    });
    expect(JSON.stringify(page)).not.toContain(base64);
    expect(JSON.stringify(page)).not.toContain("dataUrl");
  });
});

function proposedPlan(planId: string, createdAt: number) {
  return {
    planId,
    sourceOperationId: `operation-${planId}`,
    markdown: `# ${planId}`,
    createdAt
  };
}

function assistantText(text: string, timestamp: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "fixture",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop" as const,
    timestamp
  };
}
