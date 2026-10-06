import { File as FileIcon, RotateCw, X } from "lucide-react";
import { Button } from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import { teamChatUploads } from "./team-chat-attachment-files.js";
import { formatTeamChatBytes } from "./team-chat-presentation.js";
import type { TeamChatUpload } from "./team-chat-uploads.js";
import styles from "./TeamChatAttachments.module.css";

/** Adds picked, pasted or dropped files; returns why any were refused, for the composer to show. */
export function addTeamChatFiles(conversationId: string, files: readonly File[]): string[] {
  const copy = messages.teamChat;
  return teamChatUploads.add(conversationId, files).map((item) => copy.attachmentRefusal[item.reason](item.fileName));
}

/** Files waiting to be sent with the next message. */
export function TeamChatAttachmentTray({ uploads }: { uploads: readonly TeamChatUpload[] }) {
  const copy = messages.teamChat;
  if (uploads.length === 0) return null;
  return (
    <ul aria-label={copy.attachmentTray} className={styles.tray} data-testid="team-chat-attachment-tray">
      {uploads.map((upload) => {
        const percent = upload.byteSize === 0 ? 0 : Math.floor((upload.sentBytes / upload.byteSize) * 100);
        const status = upload.status === "failed" ? upload.error ?? copy.attachmentFailed
          : upload.status === "uploading" ? copy.attachmentUploading(percent) : formatTeamChatBytes(upload.byteSize);
        return (
          <li className={`${styles.trayItem} ${upload.status === "failed" ? styles.trayItemFailed : ""}`} key={upload.localId}>
            {upload.previewUrl
              ? <img alt="" className={styles.trayPreview} src={upload.previewUrl} />
              : <FileIcon aria-hidden="true" className={styles.trayIcon} size={18} />}
            <span className={styles.trayText}>
              <span className={styles.fileName} title={upload.fileName}>{upload.fileName}</span>
              <span className={styles.fileMeta} role={upload.status === "failed" ? "alert" : undefined}>{status}</span>
              {upload.status === "uploading" ? (
                <span aria-hidden="true" className={styles.progress}><span style={{ width: `${percent}%` }} /></span>
              ) : null}
            </span>
            {upload.status === "failed" ? (
              <Button aria-label={copy.attachmentRetry(upload.fileName)} className={styles.iconButton!}
                onPress={() => teamChatUploads.retry(upload.localId)}>
                <RotateCw aria-hidden="true" size={14} />
              </Button>
            ) : null}
            <Button aria-label={copy.attachmentRemove(upload.fileName)} className={styles.iconButton!}
              onPress={() => teamChatUploads.remove(upload.localId)}>
              <X aria-hidden="true" size={14} />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
