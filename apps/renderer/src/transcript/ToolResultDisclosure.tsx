import type { SessionMessageView } from "@pi67/domain";
import {
  Check,
  ChevronRight,
  Copy,
  Maximize2,
  Minimize2,
  TriangleAlert,
  Wrench
} from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { AssetImage } from "./AssetImage.js";
import { messageTextForCopy } from "./message-actions.js";
import styles from "./MessageCard.module.css";

type CopyState = "idle" | "copied" | "failed";

export function ToolResultDisclosure({
  message,
  defaultOpen = false
}: {
  message: SessionMessageView;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const text = messageTextForCopy(message);
  const hasLongText = (text?.length ?? 0) > 800;
  const failed = Boolean(message.error);

  async function copyResult() {
    if (!text) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch (error) {
      setCopyState("failed");
      publishNotification({
        level: "error",
        title: messages.transcript.copyFailed,
        message: error instanceof Error ? error.message : messages.runtime.unknownError
      });
    }
  }

  return (
    <details
      className={`${styles.toolResult} ${failed ? styles.toolResultFailed : ""}`}
      data-tool-result-status={failed ? "failed" : "completed"}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (!nextOpen) setExpanded(false);
      }}
    >
      <summary>
        <Wrench aria-hidden="true" size={14} />
        <span className={styles.toolResultIdentity}>
          <strong>工具结果</strong>
          <code>{message.toolName ?? "tool"}</code>
        </span>
        <span className={styles.toolResultStatus}>{failed ? "失败" : "完成"}</span>
        <ChevronRight aria-hidden="true" className={styles.toolResultChevron} size={14} />
      </summary>
      {open ? (
        <div className={styles.toolResultBody}>
          {text ? (
            <pre className={expanded ? styles.toolResultRawExpanded : undefined}>{text}</pre>
          ) : message.error ? (
            <p className={styles.toolResultError}>{message.error}</p>
          ) : (
            <p className={styles.toolResultEmpty}>工具没有返回可显示的文本内容。</p>
          )}
          {message.parts.map((part, index) => part.type === "image" ? (
            <AssetImage
              asset={part.asset}
              key={`${message.id}-tool-image-${index}`}
              mimeType={part.mimeType}
              name={part.name}
            />
          ) : null)}
          <div className={styles.toolResultActions}>
            {hasLongText ? (
              <Button className={styles.toolResultButton!} onPress={() => setExpanded((value) => !value)}>
                {expanded ? <Minimize2 aria-hidden="true" size={13} /> : <Maximize2 aria-hidden="true" size={13} />}
                {expanded ? "收起内容" : "展开全部"}
              </Button>
            ) : null}
            <Button
              className={styles.toolResultButton!}
              isDisabled={!text}
              onPress={() => void copyResult()}
            >
              {copyState === "copied"
                ? <Check aria-hidden="true" size={13} />
                : copyState === "failed"
                  ? <TriangleAlert aria-hidden="true" size={13} />
                  : <Copy aria-hidden="true" size={13} />}
              {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制结果"}
            </Button>
          </div>
        </div>
      ) : null}
    </details>
  );
}
