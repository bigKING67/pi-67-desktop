import type { SessionMessageView } from "@pi67/domain";
import { Bot, UserRound, Wrench } from "lucide-react";
import { ToolCard } from "../tool-cards/index.js";
import { AssetImage } from "./AssetImage.js";
import { MarkdownView } from "./MarkdownView.js";

export function MessageCard({ message, streaming = false }: { message: SessionMessageView; streaming?: boolean }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  return (
    <article
      className={`message-card role-${message.role}`}
      aria-busy={streaming || undefined}
      aria-label={streaming ? "Pi 正在回复" : `${message.role} message`}
      data-render-mode={streaming ? "streaming" : "settled"}
    >
      <header className="message-header">
        <span className="message-author">
          {isUser ? <UserRound size={14} /> : isTool ? <Wrench size={14} /> : <Bot size={14} />}
          {isUser ? "你" : isTool ? "工具" : "Pi"}
        </span>
        <span className="message-meta">
          {message.model ? <code>{message.model}</code> : null}
          {message.stopped ? "已停止" : null}
        </span>
      </header>
      <div className="message-content">
        {message.parts.map((part, index) => {
          if (part.type === "thinking") {
            return (
              <details className="thinking-block" key={`${message.id}-thinking-${index}`}>
                <summary>推理过程</summary>
                <MarkdownView mode={streaming ? "streaming" : "settled"}>{part.text}</MarkdownView>
              </details>
            );
          }
          if (part.type === "text") return <MarkdownView key={`${message.id}-text-${index}`} mode={streaming ? "streaming" : "settled"}>{part.text}</MarkdownView>;
          if (part.type === "image") {
            return (
              <AssetImage
                asset={part.asset}
                key={`${message.id}-image-${index}`}
                mimeType={part.mimeType}
                name={part.name}
              />
            );
          }
          if (part.type === "tool-call") return <ToolCard key={part.id} tool={part} />;
          return null;
        })}
      </div>
      {message.error ? <div className="message-error">{message.error}</div> : null}
    </article>
  );
}
