import { Download, File as FileIcon, FileArchive, FileSpreadsheet, FileText, ImageOff, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { teamChatAttachmentIsInlineImage, type TeamChatAttachment } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  saveTeamChatAttachment,
  teamChatAttachmentImages,
  teamChatImageReference,
  teamChatUploads
} from "./team-chat-attachment-files.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { formatTeamChatBytes } from "./team-chat-presentation.js";
import styles from "./TeamChatAttachments.module.css";

/** Thumbnails fit this box; the stored pixel size reserves space before the bytes arrive. */
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 240;

/** A message's files (ADR 0009): images inline, other files as cards with Save. */
export function TeamChatMessageAttachments({ attachments, pending }: { attachments: readonly TeamChatAttachment[]; pending: boolean }) {
  const [viewing, setViewing] = useState<TeamChatAttachment>();
  const images = attachments.filter(teamChatAttachmentIsInlineImage);
  const files = attachments.filter((item) => !teamChatAttachmentIsInlineImage(item));
  return (
    <div className={styles.attachments} data-testid="team-chat-attachments">
      {images.length > 0 ? (
        <div className={styles.images}>
          {images.map((image) => <Thumbnail attachment={image} key={image.id} onOpen={() => setViewing(image)} />)}
        </div>
      ) : null}
      {files.map((file) => <FileCard attachment={file} key={file.id} pending={pending} />)}
      {viewing ? <ImageViewer attachment={viewing} onClose={() => setViewing(undefined)} pending={pending} /> : null}
    </div>
  );
}

type ImageState = { status: "loading" } | { status: "ready"; url: string } | { status: "error" };

/** A just-sent image shows its local copy; others are read through the bounded cache. */
function useAttachmentImage(attachment: TeamChatAttachment): { state: ImageState; retry: () => void } {
  const local = teamChatUploads.sentPreview(attachment.id);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ImageState>({ status: "loading" });
  useEffect(() => {
    if (local) return;
    let active = true;
    setState({ status: "loading" });
    const lease = teamChatAttachmentImages.acquire(teamChatImageReference(attachment));
    void lease.value.then(
      ({ objectUrl }) => { if (active) setState({ status: "ready", url: objectUrl }); },
      () => { if (active) setState({ status: "error" }); }
    );
    return () => {
      active = false;
      lease.release();
    };
  }, [attachment.id, attachment.byteSize, local, attempt]);
  return { state: local ? { status: "ready", url: local } : state, retry: () => setAttempt((value) => value + 1) };
}

function thumbnailSize(attachment: TeamChatAttachment): { width: number; height: number } {
  if (!attachment.width || !attachment.height) return { width: THUMB_WIDTH, height: THUMB_HEIGHT * 0.75 };
  const scale = Math.min(1, THUMB_WIDTH / attachment.width, THUMB_HEIGHT / attachment.height);
  return { width: Math.max(48, Math.round(attachment.width * scale)), height: Math.max(48, Math.round(attachment.height * scale)) };
}

function Thumbnail({ attachment, onOpen }: { attachment: TeamChatAttachment; onOpen: () => void }) {
  const copy = messages.teamChat;
  const { state, retry } = useAttachmentImage(attachment);
  const size = thumbnailSize(attachment);
  if (state.status === "error") {
    return (
      <div className={`${styles.thumbnail} ${styles.thumbnailError}`} role="alert" style={size}>
        <ImageOff aria-hidden="true" size={16} />
        <span>{copy.attachmentImageFailed}</span>
        <Button className={styles.inlineAction!} onPress={retry}>
          <RotateCw aria-hidden="true" size={12} />{copy.attachmentImageRetry}
        </Button>
      </div>
    );
  }
  return (
    <Button aria-label={copy.attachmentOpenImage(attachment.fileName)} className={styles.thumbnail!}
      isDisabled={state.status !== "ready"} onPress={onOpen} style={size}>
      {state.status === "ready"
        ? <img alt="" decoding="async" src={state.url} />
        : <span aria-label={copy.attachmentImageLoading(attachment.fileName)} className={styles.thumbnailLoading} role="status" />}
    </Button>
  );
}

function fileIcon(fileName: string) {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  if (["zip", "7z", "rar", "tar", "gz", "tgz"].includes(extension)) return FileArchive;
  if (["xls", "xlsx", "csv", "tsv", "numbers"].includes(extension)) return FileSpreadsheet;
  if (["pdf", "doc", "docx", "txt", "md", "rtf", "pages", "ppt", "pptx", "key", "json", "xml"].includes(extension)) return FileText;
  return FileIcon;
}

function FileCard({ attachment, pending }: { attachment: TeamChatAttachment; pending: boolean }) {
  const Icon = fileIcon(attachment.fileName);
  return (
    <div className={styles.fileCard} data-testid="team-chat-file-card">
      <Icon aria-hidden="true" className={styles.fileIcon} size={20} />
      <span className={styles.fileText}>
        <span className={styles.fileName} title={attachment.fileName}>{attachment.fileName}</span>
        <span className={styles.fileMeta}>{formatTeamChatBytes(attachment.byteSize)}</span>
      </span>
      <SaveButton attachment={attachment} disabled={pending} />
    </div>
  );
}

function SaveButton({ attachment, disabled }: { attachment: TeamChatAttachment; disabled: boolean }) {
  const copy = messages.teamChat;
  const [saving, setSaving] = useState(false);
  const save = () => {
    setSaving(true);
    void saveTeamChatAttachment(attachment)
      .catch((error: unknown) => publishNotification({ level: "warning", title: copy.attachmentSaveFailed, message: teamChatErrorMessage(error) }))
      .finally(() => setSaving(false));
  };
  return (
    <Button aria-label={copy.attachmentSaveLabel(attachment.fileName)} className={styles.saveButton!}
      isDisabled={disabled || saving} onPress={save}>
      <Download aria-hidden="true" size={14} />
      <span>{saving ? copy.attachmentSaving : copy.attachmentSave}</span>
    </Button>
  );
}

function ImageViewer({ attachment, onClose, pending }: { attachment: TeamChatAttachment; onClose: () => void; pending: boolean }) {
  const copy = messages.teamChat;
  const { state } = useAttachmentImage(attachment);
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal className={styles.viewer!}>
        <Dialog aria-label={attachment.fileName} className={styles.viewerDialog!}>
          <header className={styles.viewerHeader}>
            <Heading className={styles.viewerTitle!} slot="title">{attachment.fileName}</Heading>
            <span className={styles.fileMeta}>{formatTeamChatBytes(attachment.byteSize)}</span>
            <SaveButton attachment={attachment} disabled={pending} />
            <Button aria-label={copy.attachmentViewerClose} className={styles.iconButton!} onPress={onClose}>
              <X aria-hidden="true" size={16} />
            </Button>
          </header>
          <div className={styles.viewerStage}>
            {state.status === "ready" ? <img alt={attachment.fileName} src={state.url} /> : null}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
