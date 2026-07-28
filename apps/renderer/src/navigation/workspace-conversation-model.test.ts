import { describe, expect, it } from "vitest";
import type { RendererWorkbenchTask } from "../workbench/workbench-store.js";
import { conversationRows } from "./workspace-conversation-model.js";

describe("workspace conversation model", () => {
  it.each([
    ["cwd", "hidden-folder"],
    ["path", "session-source.jsonl"],
    ["id", "session-identity-67"]
  ])("keeps a server result visible when the query matches its %s", (_field, query) => {
    const rows = conversationRows("workspace-test", [], [{
      id: "session-identity-67",
      path: "/Users/test/.pi/agent/sessions/session-source.jsonl",
      cwd: "/Users/test/Projects/hidden-folder",
      name: "服务端命中",
      modifiedAt: 1_800_000_000_000,
      messageCount: 3
    }], query);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("服务端命中");
  });

  it("uses the latest in-memory user message as the row title without losing the stable Session name", () => {
    const session = {
      id: "session-identity-67",
      path: "/Users/test/.pi/agent/sessions/session-source.jsonl",
      cwd: "/Users/test/Projects/pi",
      name: "稳定的 Pi 会话名",
      modifiedAt: 1_800_000_000_000,
      messageCount: 12
    };
    const task: RendererWorkbenchTask = {
      id: "task-67",
      conversation: { kind: "session", workspaceId: "workspace-test", sessionPath: session.path },
      workspaceId: "workspace-test",
      sessionId: session.id,
      taskGeneration: 1,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      title: session.name,
      recentUserMessagePreview: "重新检查双栏设置的响应式问题",
      sessionPath: session.path,
      hasDraft: false,
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
});
