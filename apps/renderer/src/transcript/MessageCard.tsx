import type { SessionMessageView } from "@pi67/domain";
import { Bot, CheckCircle2, CircleDashed, UserRound, Wrench } from "lucide-react";
import { MarkdownView } from "./MarkdownView.js";

export function MessageCard({ message }: { message: SessionMessageView }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  return (
    <article className={`message-card role-${message.role}`} aria-label={`${message.role} message`}>
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
                <MarkdownView>{part.text}</MarkdownView>
              </details>
            );
          }
          if (part.type === "text") return <MarkdownView key={`${message.id}-text-${index}`}>{part.text}</MarkdownView>;
          if (part.type === "image") return part.dataUrl ? <img className="message-image" key={`${message.id}-image-${index}`} src={part.dataUrl} alt={part.name ?? "Attached image"} /> : null;
          if (part.type === "tool-call") {
            return (
              <div className={`tool-call status-${part.status}`} key={part.id}>
                {part.status === "completed" ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}
                <div><strong>{part.name}</strong>{part.summary ? <code>{part.summary}</code> : null}</div>
              </div>
            );
          }
          return null;
        })}
      </div>
      {message.error ? <div className="message-error">{message.error}</div> : null}
    </article>
  );
}
