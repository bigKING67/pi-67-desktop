import type { SessionMessageView } from "@pi67/domain";
import { Bot, Wrench } from "lucide-react";
import { ToolCard } from "../tool-cards/index.js";
import { AssetImage } from "./AssetImage.js";
import { MarkdownView } from "./MarkdownView.js";
import styles from "./MessageCard.module.css";

interface LocalMessageImage {
  mimeType: string;
  name: string;
  objectUrl: string;
}

interface MessageCardProps {
  message: SessionMessageView;
  streaming?: boolean;
  deliveryStatus?: "accepted" | "failed";
  localImages?: LocalMessageImage[];
}

export function MessageCard({
  message,
  streaming = false,
  deliveryStatus,
  localImages = []
}: MessageCardProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const ariaLabel = streaming
    ? "Pi 正在回复"
    : isUser
      ? "用户消息"
      : isTool
        ? "工具消息"
        : "Pi 消息";
  return (
    <article
      className={`${styles.card} ${isUser ? styles.user : ""}`}
      aria-busy={streaming || undefined}
      aria-label={ariaLabel}
      data-delivery-status={deliveryStatus}
      data-message-id={message.id}
      data-testid="message-card"
      data-render-mode={streaming ? "streaming" : "settled"}
    >
      {isUser ? null : (
        <header className={styles.header}>
          <span className={styles.author}>
            {isTool ? <Wrench size={14} /> : <Bot size={14} />}
            {isTool ? "工具" : "Pi"}
          </span>
          <span className={styles.meta}>
            {message.model ? <code>{message.model}</code> : null}
            {message.stopped ? "已停止" : null}
          </span>
        </header>
      )}
      <div className={styles.content} data-testid="message-content">
        {message.parts.map((part, index) => {
          if (part.type === "thinking") {
            return (
              <details className={styles.thinking} key={`${message.id}-thinking-${index}`}>
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
        {localImages.map((image) => (
          <AssetImage
            key={`${message.id}-local-image-${image.objectUrl}`}
            mimeType={image.mimeType}
            name={image.name}
            objectUrl={image.objectUrl}
          />
        ))}
      </div>
      {message.error ? (
        <div className={styles.error} role={deliveryStatus === "failed" ? "alert" : undefined}>
          {message.error}
        </div>
      ) : null}
    </article>
  );
}
