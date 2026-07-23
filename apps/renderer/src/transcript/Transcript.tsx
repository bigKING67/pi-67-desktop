import type { SessionMessageView } from "@pi67/domain";
import { MessageSquareText } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useAppStore } from "../app/app-store.js";
import { MessageCard } from "./MessageCard.js";

export function Transcript() {
  const snapshot = useAppStore((state) => state.snapshot);
  const liveText = useAppStore((state) => state.liveText);
  const liveThinking = useAppStore((state) => state.liveThinking);
  const messages = snapshot?.messages ?? [];
  const data = liveText || liveThinking
    ? [...messages, liveMessage(liveText, liveThinking)]
    : messages;

  if (!snapshot) {
    return <div className="transcript-loading"><span className="loading-line" />正在创建 Pi session</div>;
  }

  if (data.length === 0) {
    return (
      <div className="transcript-empty">
        <div className="empty-icon"><MessageSquareText size={22} /></div>
        <h2>从一个具体任务开始</h2>
        <p>描述目标、相关文件和验收标准。Pi 会使用当前工作区、模型和已加载资源。</p>
        <div className="starter-prompts">
          <span>解释这个项目的运行入口</span>
          <span>检查当前 Git 改动并找出风险</span>
          <span>实现一个有测试覆盖的小功能</span>
        </div>
      </div>
    );
  }

  return (
    <div className="transcript-region" data-message-count={data.length}>
      <Virtuoso
        data={data}
        followOutput={snapshot.streaming ? "auto" : false}
        increaseViewportBy={{ top: 500, bottom: 800 }}
        itemContent={(_index, message) => <MessageCard message={message} />}
      />
    </div>
  );
}

function liveMessage(text: string, thinking: string): SessionMessageView {
  return {
    id: "live-assistant-message",
    role: "assistant",
    parts: [
      ...(thinking ? [{ type: "thinking" as const, text: thinking }] : []),
      ...(text ? [{ type: "text" as const, text }] : [])
    ]
  };
}
