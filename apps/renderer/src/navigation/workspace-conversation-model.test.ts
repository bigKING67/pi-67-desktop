import { describe, expect, it } from "vitest";
import type { RendererWorkbenchTask } from "../workbench/workbench-store.js";
import {
  conversationRows,
  formatSnoozeTimestamp,
  workspaceStatus
} from "./workspace-conversation-model.js";

describe("workspace conversation model", () => {
  it.each([
    ["cwd", "hidden-folder"],
    ["path", "session-source.jsonl"],
    ["id", "session-identity-67"]
  ])("keeps a server result visible when the query matches its %s", (_field, query) => {
    const rows = conversationRows("workspace-test", [], [{
      fileIdentity: "session-file-fixture-67",
      id: "session-identity-67",
      path: "/Users/test/.pi/agent/sessions/session-source.jsonl",
      cwd: "/Users/test/Projects/hidden-folder",
      name: "服务端命中",
      nameSource: "explicit" as const,
      modifiedAt: 1_800_000_000_000,
      messageCount: 3
    }], query);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("服务端命中");
  });

  it("uses the latest in-memory user message as the row title without losing the stable Session name", () => {
    const session = {
      fileIdentity: "session-file-fixture-67",
      id: "session-identity-67",
      path: "/Users/test/.pi/agent/sessions/session-source.jsonl",
      cwd: "/Users/test/Projects/pi",
      name: "稳定的 Pi 会话名",
      nameSource: "explicit" as const,
      modifiedAt: 1_800_000_000_000,
      messageCount: 12
    };
    const task: RendererWorkbenchTask = {
      id: "task-67",
      conversation: {
        kind: "session",
        workspaceId: "workspace-test",
        sessionFileIdentity: session.fileIdentity,
        sessionPath: session.path
      },
      workspaceId: "workspace-test",
      sessionId: session.id,
      sessionFileIdentity: session.fileIdentity,
      taskGeneration: 1,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      title: session.name,
      recentUserMessagePreview: "重新检查双栏设置的响应式问题",
      sessionPath: session.path,
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    };

    const [row] = conversationRows("workspace-test", [task], [session], "");

    expect(row).toMatchObject({
      title: "重新检查双栏设置的响应式问题",
      meta: expect.stringContaining("稳定的 Pi 会话名")
    });
    expect(conversationRows("workspace-test", [task], [session], "重新检查")).toHaveLength(1);
    expect(conversationRows("workspace-test", [task], [session], "稳定的 Pi 会话名")).toHaveLength(1);
  });

  it("keeps a continuation Task distinguishable until its first new Prompt", () => {
    const task: RendererWorkbenchTask = {
      id: "task-continuation",
      conversation: {
        kind: "session",
        workspaceId: "workspace-test",
        sessionFileIdentity: "session-file-continuation",
        sessionPath: "/sessions/continuation.jsonl"
      },
      workspaceId: "workspace-test",
      sessionId: "session-continuation",
      taskGeneration: 1,
      sessionGeneration: 2,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      title: "接续：原任务",
      pendingTitle: "接续：原任务",
      recentUserMessagePreview: "原任务的最后一条问题",
      sessionPath: "/sessions/continuation.jsonl",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    };

    expect(conversationRows("workspace-test", [task], [], "")[0]).toMatchObject({
      title: "接续：原任务",
      meta: "接续：原任务"
    });
  });

  it("joins a Task to Catalog metadata by physical identity while accepting a new locator", () => {
    const task = materializedTask({
      sessionFileIdentity: "session-file-shared",
      sessionPath: "/sessions/original.jsonl"
    });
    const session = {
      fileIdentity: "session-file-shared",
      id: "session-shared",
      path: "/junction/sessions/alias.jsonl",
      cwd: "/work",
      name: "Alias title",
      nameSource: "explicit" as const,
      modifiedAt: 100,
      messageCount: 2
    };

    const rows = conversationRows("workspace-test", [task], [session], "");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      identity: "session:workspace-test:session-file-shared",
      session: { path: "/junction/sessions/alias.jsonl" }
    });
  });

  it("keeps equal Session ids on distinct physical files as separate rows", () => {
    const sessions = ["a", "b"].map((suffix, index) => ({
      fileIdentity: `session-file-${suffix}`,
      id: "duplicate-session-id",
      path: `/sessions/${suffix}.jsonl`,
      cwd: "/work",
      name: suffix,
      nameSource: "explicit" as const,
      modifiedAt: 100 - index,
      messageCount: 1
    }));

    expect(conversationRows("workspace-test", [], sessions, "").map((row) => row.identity)).toEqual([
      "session:workspace-test:session-file-a",
      "session:workspace-test:session-file-b"
    ]);
  });

  it("exposes movement boundaries from the authoritative pinned order", () => {
    const sessions = [
      { suffix: "a", pinnedAt: 300 },
      { suffix: "b", pinnedAt: 200 },
      { suffix: "c", pinnedAt: 100 },
      { suffix: "d", pinnedAt: undefined }
    ].map(({ suffix, pinnedAt }, index) => ({
      fileIdentity: `session-file-${suffix}`,
      id: `session-${suffix}`,
      path: `/sessions/${suffix}.jsonl`,
      cwd: "/work",
      name: suffix,
      nameSource: "explicit" as const,
      modifiedAt: 100 - index,
      messageCount: 1,
      ...(pinnedAt === undefined ? {} : { pinnedAt })
    }));

    expect(conversationRows("workspace-test", [], sessions, "").map((row) => ({
      title: row.title,
      up: row.canMovePinnedUp,
      down: row.canMovePinnedDown
    }))).toEqual([
      { title: "a", up: false, down: true },
      { title: "b", up: true, down: true },
      { title: "c", up: true, down: false },
      { title: "d", up: false, down: false }
    ]);
  });

  it("moves only future idle sessions into the Snoozed shelf and wakes them at the absolute deadline", () => {
    const now = new Date(2026, 7, 8, 16).getTime();
    const session = {
      fileIdentity: "session-file-snoozed",
      id: "session-snoozed",
      path: "/sessions/snoozed.jsonl",
      cwd: "/work",
      name: "Snoozed",
      nameSource: "explicit" as const,
      modifiedAt: now - 1_000,
      messageCount: 1,
      pinnedAt: 100,
      snoozedUntil: now + 60_000
    };

    expect(conversationRows("workspace-test", [], [session], "", now)[0]).toMatchObject({
      snoozed: true,
      snoozedUntil: now + 60_000,
      pinned: false,
      meta: expect.stringContaining(formatSnoozeTimestamp(now + 60_000))
    });
    expect(conversationRows("workspace-test", [], [session], "", now + 60_000)[0]).toMatchObject({
      snoozed: false,
      pinned: true
    });

    const activeTask = materializedTask({
      sessionFileIdentity: session.fileIdentity,
      sessionPath: session.path
    });
    activeTask.lifecycle = "running";
    expect(conversationRows("workspace-test", [activeTask], [session], "", now)[0]).toMatchObject({
      priority: true,
      snoozed: false
    });
  });

  it("keeps path-only recovery visibly gated on explicit confirmation", () => {
    expect(workspaceStatus({ availability: "needs-confirmation", trust: "unknown" }))
      .toBe("需要重新确认");
  });

});

function materializedTask({ sessionFileIdentity, sessionPath }: {
  sessionFileIdentity: string;
  sessionPath: string;
}): RendererWorkbenchTask {
  return {
    id: "task-shared",
    conversation: {
      kind: "session",
      workspaceId: "workspace-test",
      sessionFileIdentity,
      sessionPath
    },
    workspaceId: "workspace-test",
    sessionId: "session-shared",
    sessionFileIdentity,
    sessionPath,
    taskGeneration: 1,
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "ready", recoverable: true },
    title: "Task title",
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0
  };
}
