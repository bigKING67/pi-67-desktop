import { describe, expect, it } from "vitest";
import type { RendererWorkbenchTask } from "./workbench-store.js";
import { conversationPrimaryTitle } from "./conversation-title.js";

describe("conversation title", () => {
  it("uses the Catalog title for a recovered task with only a generic fallback title", () => {
    const session = {
      id: "session-recovered",
      path: "/sessions/recovered.jsonl",
      cwd: "/Users/test/Projects/pi",
      name: "已保存的会话",
      nameSource: "explicit" as const,
      modifiedAt: 1_800_000_000_000,
      messageCount: 8
    };
    const task: RendererWorkbenchTask = {
      id: "task-recovered",
      conversation: { kind: "session", workspaceId: "workspace-test", sessionPath: session.path },
      workspaceId: "workspace-test",
      sessionId: session.id,
      taskGeneration: 1,
      lifecycle: "stopped",
      runtime: { phase: "stopped", detail: "会话尚未运行", recoverable: true },
      title: "未命名会话",
      sessionPath: session.path,
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    };

    expect(conversationPrimaryTitle(task, session)).toBe("已保存的会话");
  });
});
