import type { PromptAttachmentKind } from "@pi67/protocol";
import {
  Archive,
  File,
  FileText,
  Image,
  Music2,
  Video,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import styles from "./AttachmentPreview.module.css";

interface AttachmentPreviewDescriptor {
  id: string;
  name: string;
  mimeType: string;
  byteLength: number;
  kind: PromptAttachmentKind;
  previewUrl?: string;
}

interface AttachmentPreviewProps {
  attachment: AttachmentPreviewDescriptor;
  removeLabel?: string;
  disabled?: boolean;
  onRemove?: (() => void) | undefined;
}

export function AttachmentPreview({
  attachment,
  removeLabel,
  disabled = false,
  onRemove
}: AttachmentPreviewProps) {
  return (
    <article className={styles.root} data-attachment-kind={attachment.kind}>
      {attachment.kind === "image" && attachment.previewUrl ? (
        <img alt={attachment.name} className={styles.thumbnail} src={attachment.previewUrl} />
      ) : (
        <span className={styles.icon} aria-hidden="true">{attachmentIcon(attachment.kind)}</span>
      )}
      <span className={styles.identity}>
        <strong title={attachment.name}>{attachment.name}</strong>
        <small>{attachmentKindLabel(attachment.kind)} · {formatAttachmentFileSize(attachment.byteLength)}</small>
      </span>
      {onRemove ? (
        <button
          aria-label={removeLabel ?? `移除附件：${attachment.name}`}
          className={styles.remove}
          disabled={disabled}
          type="button"
          onClick={onRemove}
        >
          <X aria-hidden="true" size={14} />
        </button>
      ) : null}
    </article>
  );
}

function attachmentKindLabel(kind: PromptAttachmentKind): string {
  const labels: Record<PromptAttachmentKind, string> = {
    image: "图片",
    document: "文档",
    archive: "压缩包",
    audio: "音频",
    video: "视频",
    file: "文件"
  };
  return labels[kind];
}

function formatAttachmentFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}

function attachmentIcon(kind: PromptAttachmentKind): ReactNode {
  switch (kind) {
    case "image": return <Image size={18} />;
    case "document": return <FileText size={18} />;
    case "archive": return <Archive size={18} />;
    case "audio": return <Music2 size={18} />;
    case "video": return <Video size={18} />;
    case "file": return <File size={18} />;
  }
}
