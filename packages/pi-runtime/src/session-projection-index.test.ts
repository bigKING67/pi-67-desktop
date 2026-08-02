import {
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type SessionEntry,
  type SessionTreeNode
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { projectMessagePage } from "./message-projection.js";
import { SessionProjectionIndex } from "./session-projection-index.js";
import { projectSessionTree } from "./session-tree-projection.js";
import { projectWorkspaceChanges } from "./workspace-change-projection.js";

describe("SessionProjectionIndex", () => {
  it("scans the append-only entries once and shares the result across desktop projections", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "projection-index" });
    const timestamp = Date.now() + 1_000;
    const ids: string[] = [];
    for (let index = 0; index < 1_000; index += 1) {
      ids.push(manager.appendMessage({ role: "user", content: `Message ${index}`, timestamp: timestamp + index }));
    }
    const getEntries = vi.spyOn(manager, "getEntries");
    const getBranch = vi.spyOn(manager, "getBranch");
    const getTree = vi.spyOn(manager, "getTree");
    const projection = new SessionProjectionIndex();

    projection.bind(manager);
    const recent = projectMessagePage(projection);
    const older = projectMessagePage(projection, {
      direction: "older",
      cursor: recent.startCursor!,
      limit: 100
    });
    const tree = projectSessionTree(projection);
    const changes = projectWorkspaceChanges(projection);
    const stats = projection.getStats(fakeSession(manager));

    expect(getEntries).toHaveBeenCalledOnce();
    expect(getBranch).not.toHaveBeenCalled();
    expect(getTree).not.toHaveBeenCalled();
    expect(recent.messages).toHaveLength(100);
    expect(recent.messages[0]?.id).toBe(ids[900]);
    expect(older.messages[0]?.id).toBe(ids[800]);
    expect(tree).toMatchObject({ total: 1_000, truncated: true });
    expect(changes).toMatchObject({ total: 0, items: [] });
    expect(stats).toMatchObject({ totalMessages: 1_000, userMessages: 1_000, tokens: { total: 0 } });
    expect(projection.getMetadata(manager)).toMatchObject({ messageCount: 1_000, modifiedAt: timestamp + 999 });
  });

  it("updates metadata, usage, branch lookup and tree state from entry events without rescanning", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "projection-events" });
    const timestamp = Date.now() + 1_000;
    const firstId = manager.appendMessage({ role: "user", content: "First", timestamp });
    const projection = new SessionProjectionIndex();
    const getEntries = vi.spyOn(manager, "getEntries");
    projection.bind(manager);

    const assistantId = manager.appendMessage(assistantMessage("Second", timestamp + 1));
    projection.observe(manager, appended(manager, assistantId));
    projection.observe(manager, appended(manager, assistantId));
    const labelId = manager.appendLabelChange(firstId, "Pinned entry");
    projection.observe(manager, appended(manager, labelId));

    expect(getEntries).toHaveBeenCalledOnce();
    expect(projectMessagePage(projection).messages.map((message) => message.id)).toEqual([firstId, assistantId]);
    expect(projection.findBranchEntryIndex(assistantId)).toBe(1);
    expect(projection.getMetadata(manager)).toMatchObject({ messageCount: 2, modifiedAt: timestamp + 1 });
    expect(projection.getStats(fakeSession(manager))).toMatchObject({
      userMessages: 1,
      assistantMessages: 1,
      totalMessages: 2,
      tokens: { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, total: 23 },
      cost: 0.25
    });
    expect(flattenTree(projection.getTree()).find((node) => node.entry.id === firstId)).toMatchObject({
      label: "Pinned entry"
    });
  });

  it("tracks Pi branch navigation and preserves upstream tree ordering and labels", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "projection-branch" });
    const firstId = manager.appendMessage({ role: "user", content: "First", timestamp: 1 });
    manager.appendMessage({ role: "user", content: "Original branch", timestamp: 2 });
    manager.appendLabelChange(firstId, "Root label");
    const projection = new SessionProjectionIndex();
    projection.bind(manager);

    manager.branch(firstId);
    expect(projection.getBranch().map((entry) => entry.id)).toEqual(manager.getBranch().map((entry) => entry.id));
    const branchId = manager.appendMessage({ role: "user", content: "New branch", timestamp: 3 });
    projection.observe(manager, appended(manager, branchId));

    expect(projection.getBranch().map((entry) => entry.id)).toEqual(manager.getBranch().map((entry) => entry.id));
    expect(flattenTree(projection.getTree()).map(treeRecord)).toEqual(flattenTree(manager.getTree()).map(treeRecord));
  });

  it("indexes only user messages on the active branch with bounded metadata and revision changes", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "projection-user-index" });
    const firstId = manager.appendMessage({ role: "user", content: "First   user message", timestamp: 1 });
    const assistantId = manager.appendMessage(assistantMessage("Assistant response", 2));
    const originalBranchId = manager.appendMessage({ role: "user", content: "Original branch", timestamp: 3 });
    const projection = new SessionProjectionIndex();
    projection.bind(manager);
    const initialRevision = projection.getRevision();

    expect(projection.getUserMessages()).toEqual([
      expect.objectContaining({ id: firstId, ordinal: 1, preview: "First user message", createdAt: 1 }),
      expect.objectContaining({ id: originalBranchId, ordinal: 2, preview: "Original branch", createdAt: 3 })
    ]);
    expect(projection.getUserMessages().some((item) => item.id === assistantId)).toBe(false);

    manager.branch(firstId);
    expect(projection.getUserMessages()).toEqual([
      expect.objectContaining({ id: firstId, ordinal: 1 })
    ]);
    expect(projection.getRevision()).toBeGreaterThan(initialRevision);

    const newBranchId = manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "New branch message" }, { type: "image", mimeType: "image/png", data: "AQID" }],
      timestamp: 4
    });
    projection.observe(manager, appended(manager, newBranchId));
    expect(projection.getUserMessages()).toEqual([
      expect.objectContaining({ id: firstId, ordinal: 1 }),
      expect.objectContaining({ id: newBranchId, ordinal: 2, preview: "New branch message", imageCount: 1 })
    ]);
  });
});

function appended(manager: SessionManager, id: string): AgentSessionEvent {
  const entry = manager.getEntry(id);
  if (!entry) throw new Error(`Missing fixture entry ${id}.`);
  return { type: "entry_appended", entry };
}

function fakeSession(manager: SessionManager): AgentSession {
  return {
    sessionManager: manager,
    sessionFile: manager.getSessionFile(),
    getContextUsage: () => undefined
  } as unknown as AgentSession;
}

function assistantMessage(text: string, timestamp: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "pi67-test",
    model: "fixture",
    usage: {
      input: 11,
      output: 7,
      cacheRead: 3,
      cacheWrite: 2,
      totalTokens: 23,
      cost: { input: 0.1, output: 0.1, cacheRead: 0.03, cacheWrite: 0.02, total: 0.25 }
    },
    stopReason: "stop" as const,
    timestamp
  };
}

function flattenTree(roots: SessionTreeNode[]): SessionTreeNode[] {
  const result: SessionTreeNode[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    result.push(node);
    stack.push(...node.children.toReversed());
  }
  return result;
}

function treeRecord(node: SessionTreeNode): Pick<SessionEntry, "id" | "parentId" | "type"> & {
  label?: string;
  labelTimestamp?: string;
} {
  return {
    id: node.entry.id,
    parentId: node.entry.parentId,
    type: node.entry.type,
    ...(node.label === undefined ? {} : { label: node.label }),
    ...(node.labelTimestamp === undefined ? {} : { labelTimestamp: node.labelTimestamp })
  };
}
