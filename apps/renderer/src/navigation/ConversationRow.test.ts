import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationRow } from "./ConversationRow.js";
import type { ConversationRowModel } from "./workspace-conversation-model.js";

describe("ConversationRow", () => {
  it("exposes an overflow menu for a safe provisional draft", () => {
    const markup = renderToStaticMarkup(createElement(ConversationRow, {
      row: provisionalRow(),
      selected: true,
      selectedRow: createRef<HTMLElement>(),
      disabled: false
    }));

    expect(markup).toContain("未命名会话 草稿菜单");
    expect(markup).toContain("aria-haspopup=\"true\"");
  });
});

function provisionalRow(): ConversationRowModel {
  const conversation = {
    kind: "provisional" as const,
    workspaceId: "workspace-a",
    draftId: "draft-a"
  };
  return {
    identity: "provisional:workspace-a:draft-a",
    conversation,
    task: {
      id: "draft-a",
      conversation,
      workspaceId: "workspace-a",
      sessionId: "pending:draft-a",
      taskGeneration: 1,
      lifecycle: "draft",
      runtime: { phase: "stopped", detail: "draft", recoverable: true },
      title: "未命名会话",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    },
    title: "未命名会话",
    meta: "尚未保存 · 当前草稿",
    status: "draft",
    priority: true,
    pinned: false,
    snoozed: false,
    canMovePinnedUp: false,
    canMovePinnedDown: false,
    titleSource: "fallback",
    modifiedAt: 0
  };
}
