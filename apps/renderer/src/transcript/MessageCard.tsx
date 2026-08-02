import type { SessionMessageView } from "@pi67/domain";
import {
  Bot,
  Check,
  Copy,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  TriangleAlert
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import { AttachmentPreview } from "../attachments/AttachmentPreview.js";
import { isImeConfirmationKey } from "../input/ime-keyboard.js";
import { formatMessageDateTime, formatMessageDateTimeTitle } from "../localization/date-time.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { ToolCard } from "../tool-cards/index.js";
import { AssetImage } from "./AssetImage.js";
import { MarkdownView } from "./MarkdownView.js";
import { ToolResultDisclosure } from "./ToolResultDisclosure.js";
import {
  editableUserMessageText,
  messageTextForCopy,
  userMessageContainsAttachment
} from "./message-actions.js";
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
  actionDisabledReason?: string | undefined;
  highlighted?: boolean;
  onContinue?: (() => Promise<boolean>) | undefined;
  onEditStart?: (() => void) | undefined;
  edit?: {
    value: string;
    phase: "editing" | "submitting" | "prepared";
    error?: string | undefined;
    onChange: (value: string) => void;
    onCancel: () => void;
    onSubmit: () => void;
  } | undefined;
}

export function MessageCard({
  message,
  streaming = false,
  deliveryStatus,
  localImages = [],
  actionDisabledReason,
  highlighted = false,
  onContinue,
  onEditStart,
  edit
}: MessageCardProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isAssistant = message.role === "assistant";
  const toolErrorAlreadyVisible = isTool && message.parts.some(
    (part) => part.type === "text" && part.text.trim() !== ""
  );
  const isSettled = !streaming && deliveryStatus === undefined;
  const ariaLabel = streaming
    ? "Pi 正在回复"
    : isUser
      ? "用户消息"
      : isTool
        ? "工具消息"
        : "Pi 消息";

  return (
    <article
      className={`${styles.card} ${isUser ? styles.user : ""} ${edit ? styles.userEditing : ""} ${highlighted ? styles.highlighted : ""}`}
      aria-busy={streaming || undefined}
      aria-label={ariaLabel}
      data-delivery-status={deliveryStatus}
      data-message-id={message.id}
      data-testid="message-card"
      data-render-mode={streaming ? "streaming" : "settled"}
      data-edit-phase={edit?.phase}
      data-highlighted={highlighted || undefined}
      tabIndex={-1}
    >
      {isUser || isTool ? null : (
        <header className={styles.header}>
          <span className={styles.author}>
            <Bot size={14} />
            Pi
          </span>
          {message.stopped ? <span className={styles.meta}>已停止</span> : null}
        </header>
      )}
      <div className={styles.content} data-testid="message-content">
        {isTool && !edit ? <ToolResultDisclosure message={message} /> : edit ? <InlineUserMessageEditor edit={edit} /> : message.parts.map((part, index) => {
          if (part.type === "thinking") {
            if (part.text.trim() === "") return null;
            return (
              <details
                className={styles.thinking}
                key={`${message.id}-thinking-${index}`}
                open={streaming}
              >
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
          if (part.type === "attachment") {
            return (
              <AttachmentPreview
                attachment={part}
                key={`${message.id}-attachment-${part.id}`}
              />
            );
          }
          if (part.type === "tool-call") return <ToolCard key={part.id} tool={part} />;
          return null;
        })}
        {!edit ? localImages.map((image) => (
          <AssetImage
            key={`${message.id}-local-image-${image.objectUrl}`}
            mimeType={image.mimeType}
            name={image.name}
            objectUrl={image.objectUrl}
          />
        )) : null}
      </div>
      {!edit && !isTool && message.error && !toolErrorAlreadyVisible ? (
        <div className={styles.error} role={deliveryStatus === "failed" ? "alert" : undefined}>
          {message.error}
        </div>
      ) : null}
      {!edit && !streaming && (isUser || isAssistant) ? (
        <MessageFooter
          actionDisabledReason={actionDisabledReason}
          isSettled={isSettled}
          message={message}
          onContinue={onContinue}
          onEditStart={onEditStart}
        />
      ) : null}
    </article>
  );
}

function InlineUserMessageEditor({ edit }: {
  edit: NonNullable<MessageCardProps["edit"]>;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const submitting = edit.phase === "submitting";

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.focus();
    element.select();
  }, []);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 260)}px`;
  }, [edit.value]);

  return (
    <div className={styles.inlineEditor}>
      <textarea
        aria-label={messages.transcript.editInputLabel}
        disabled={submitting}
        ref={textarea}
        rows={1}
        value={edit.value}
        onChange={(event) => edit.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (isImeConfirmationKey(event.nativeEvent)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            edit.onCancel();
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!submitting && edit.value.trim()) edit.onSubmit();
          }
        }}
      />
      {edit.error ? <p className={styles.inlineEditError} role="alert">{edit.error}</p> : null}
      <div className={styles.inlineEditActions}>
        <button disabled={submitting} type="button" onClick={edit.onCancel}>
          {messages.common.cancel}
        </button>
        <button
          className={styles.inlineEditSubmit}
          disabled={submitting || !edit.value.trim()}
          type="button"
          onClick={edit.onSubmit}
        >
          {submitting ? <LoaderCircle aria-hidden="true" className={styles.spinning} size={13} /> : null}
          {submitting ? messages.transcript.editSending : messages.transcript.editSend}
        </button>
      </div>
    </div>
  );
}

type CopyState = "idle" | "copied" | "failed";
type MessageAction = "continue";

function MessageFooter({
  message,
  isSettled,
  actionDisabledReason,
  onContinue,
  onEditStart
}: {
  message: SessionMessageView;
  isSettled: boolean;
  actionDisabledReason?: string | undefined;
  onContinue?: (() => Promise<boolean>) | undefined;
  onEditStart?: (() => void) | undefined;
}) {
  const isUser = message.role === "user";
  const copyText = messageTextForCopy(message);
  const editText = editableUserMessageText(message);
  const containsAttachment = userMessageContainsAttachment(message);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [pendingAction, setPendingAction] = useState<MessageAction>();
  const resetCopyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyLabel = copyState === "copied"
    ? messages.transcript.copied
    : copyState === "failed"
      ? messages.transcript.copyFailed
      : isUser
        ? messages.transcript.copyMessage
        : messages.transcript.copyAnswer;

  useEffect(() => () => {
    if (resetCopyTimer.current !== undefined) clearTimeout(resetCopyTimer.current);
  }, []);

  async function copyMessage() {
    if (!copyText) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(copyText);
      setCopyState("copied");
    } catch (error) {
      setCopyState("failed");
      publishNotification({
        level: "error",
        title: messages.transcript.copyFailed,
        message: error instanceof Error ? error.message : messages.runtime.unknownError
      });
    }
    if (resetCopyTimer.current !== undefined) clearTimeout(resetCopyTimer.current);
    resetCopyTimer.current = setTimeout(() => setCopyState("idle"), 1_800);
  }

  async function runAction(action: MessageAction, callback: () => Promise<boolean>) {
    if (pendingAction) return;
    setPendingAction(action);
    try {
      await callback();
    } finally {
      setPendingAction(undefined);
    }
  }

  const timestamp = <MessageTimestamp timestamp={message.createdAt} />;
  const copyControl = (
    <MessageActionControl
      disabled={!copyText}
      icon={copyState === "copied"
        ? <Check aria-hidden="true" size={14} />
        : copyState === "failed"
          ? <TriangleAlert aria-hidden="true" size={14} />
          : <Copy aria-hidden="true" size={14} />}
      label={copyText ? copyLabel : messages.transcript.noCopyText}
      onClick={() => void copyMessage()}
      placement={isUser ? "bottom end" : "bottom start"}
      state={copyState}
    />
  );

  if (isUser) {
    const editDisabledReason = containsAttachment
      ? messages.transcript.editAttachmentUnavailable
      : !editText
        ? messages.transcript.noCopyText
        : actionDisabledReason;
    return (
      <footer className={`${styles.footer} ${styles.userFooter}`} data-message-footer="user">
        {timestamp}
        {copyControl}
        {isSettled && onEditStart ? (
          <MessageActionControl
            ariaLabel={messages.transcript.editMessage}
            disabled={Boolean(editDisabledReason) || pendingAction !== undefined}
            icon={<Pencil aria-hidden="true" size={14} />}
            label={editDisabledReason ?? messages.transcript.editMessageDetail}
            onClick={onEditStart}
            placement="bottom end"
            state="idle"
          />
        ) : null}
      </footer>
    );
  }

  return (
    <footer className={styles.footer} data-message-footer="assistant">
      {copyControl}
      {isSettled && onContinue ? (
        <MessageActionControl
          ariaLabel={messages.transcript.continueInNewTask}
          disabled={Boolean(actionDisabledReason) || pendingAction !== undefined}
          icon={pendingAction === "continue"
            ? <LoaderCircle aria-hidden="true" className={styles.spinning} size={14} />
            : <MessageSquarePlus aria-hidden="true" size={14} />}
          label={actionDisabledReason ?? messages.transcript.continueInNewTaskDetail}
          onClick={() => void runAction("continue", onContinue)}
          placement="bottom start"
          state={pendingAction === "continue" ? "pending" : "idle"}
        />
      ) : null}
      {timestamp}
    </footer>
  );
}

function MessageActionControl({
  label,
  ariaLabel = label,
  icon,
  disabled,
  onClick,
  placement,
  state
}: {
  label: string;
  ariaLabel?: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  placement: "bottom start" | "bottom end";
  state: string;
}) {
  return (
    <span className={styles.actionControl} data-action-state={state}>
      <TooltipTrigger closeDelay={80} delay={300}>
        <Button
          aria-label={ariaLabel}
          className={styles.actionButton!}
          isDisabled={disabled}
          onPress={onClick}
        >
          {icon}
        </Button>
        <Tooltip className={styles.tooltip!} offset={6} placement={placement}>{label}</Tooltip>
      </TooltipTrigger>
    </span>
  );
}

function MessageTimestamp({ timestamp }: { timestamp: number | undefined }) {
  if (timestamp === undefined) {
    return <span className={styles.timestamp}>{messages.dateTime.unknown}</span>;
  }
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return <span className={styles.timestamp}>{messages.dateTime.unknown}</span>;
  }
  return (
    <time
      className={styles.timestamp}
      dateTime={date.toISOString()}
      title={formatMessageDateTimeTitle(timestamp)}
    >
      {formatMessageDateTime(timestamp)}
    </time>
  );
}
