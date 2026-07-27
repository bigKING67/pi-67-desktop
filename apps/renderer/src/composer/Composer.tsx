import { ArrowUp, ImagePlus, ListPlus, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionGeneration,
  selectSessionId
} from "../session/session-projection-selectors.js";
import { useCommittedConversationStreaming } from "../conversation/conversation-store.js";
import { subscribeToComposerPrefill } from "./composer-events.js";
import { submitRendererPrompt } from "./prompt-submission-controller.js";
import { ExtensionWidgets } from "./ExtensionWidgets.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { isImeConfirmationKey } from "../input/ime-keyboard.js";
import { messages } from "../localization/message-catalog.js";
import styles from "./Composer.module.css";
import {
  createDraftAttachments,
  filesFromTransfer,
  formatAttachmentFileSize,
  removeDraftAttachment,
  revokeDraftAttachments,
  toTransferImages,
  transferContainsFiles,
  type DraftAttachment
} from "./composer-attachments.js";
import { ComposerQueuePanel } from "./ComposerQueuePanel.js";
import { ComposerRuntimeControls } from "./ComposerRuntimeControls.js";

export function Composer() {
  const sessionId = useSessionProjectionStore(selectSessionId);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const widgets = useExtensionUiStore((state) => state.widgets);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [submissionError, setSubmissionError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [streamBehavior, setStreamBehavior] = useState<"steer" | "followUp">("followUp");
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const attachmentsRef = useRef<DraftAttachment[]>([]);
  const attachmentDragDepth = useRef(0);
  const submissionIdRef = useRef<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const streaming = useCommittedConversationStreaming();
  const canSend = !submitting && (text.trim().length > 0 || attachments.length > 0);
  const widgetItems = Object.values(widgets);

  useEffect(() => subscribeToComposerPrefill((nextText) => {
    submissionIdRef.current = undefined;
    setText(nextText);
    requestAnimationFrame(() => textInput.current?.focus());
  }), []);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    submissionIdRef.current = undefined;
  }, [hostEpoch, sessionGeneration, sessionId]);

  useEffect(() => () => {
    revokeDraftAttachments(attachmentsRef.current);
  }, []);

  const submit = async () => {
    if (!canSend) return;
    const nextText = text.trim();
    const nextAttachments = attachments;
    setSubmitting(true);
    setSubmissionError(undefined);
    try {
      const images = await toTransferImages(nextAttachments);
      const submissionId = submissionIdRef.current ?? crypto.randomUUID();
      submissionIdRef.current = submissionId;
      const result = await submitRendererPrompt(
        nextText,
        images,
        streaming ? streamBehavior : "send",
        submissionId
      );
      if (!result.accepted) {
        setSubmissionError(result.error);
        return;
      }
      setText("");
      submissionIdRef.current = undefined;
      revokeDraftAttachments(nextAttachments);
      setAttachments([]);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : messages.composer.attachmentReadFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const removeAttachment = (id: string) => {
    submissionIdRef.current = undefined;
    setSubmissionError(undefined);
    setAttachments((items) => removeDraftAttachment(items, id));
  };

  const addAttachments = (files: Iterable<File>) => {
    setAttachmentError(undefined);
    try {
      submissionIdRef.current = undefined;
      setSubmissionError(undefined);
      setAttachments(createDraftAttachments(files, attachments));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : messages.composer.selectedImageReadFailed);
    }
  };

  return (
    <footer className={`composer-region ${styles.region}`}>
      <ExtensionWidgets items={widgetItems} placement="aboveEditor" />
      <ComposerQueuePanel />
      <div
        className={`composer-shell ${styles.shell} ${attachmentDragActive ? styles.dropActive : ""}`}
        onDragEnter={(event) => {
          if (!transferContainsFiles(event.dataTransfer)) return;
          event.preventDefault();
          attachmentDragDepth.current += 1;
          setAttachmentDragActive(true);
        }}
        onDragLeave={(event) => {
          if (!transferContainsFiles(event.dataTransfer)) return;
          event.preventDefault();
          attachmentDragDepth.current = Math.max(0, attachmentDragDepth.current - 1);
          if (attachmentDragDepth.current === 0) setAttachmentDragActive(false);
        }}
        onDragOver={(event) => {
          if (!transferContainsFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (!transferContainsFiles(event.dataTransfer)) return;
          event.preventDefault();
          attachmentDragDepth.current = 0;
          setAttachmentDragActive(false);
          addAttachments(filesFromTransfer(event.dataTransfer));
        }}
      >
        {attachmentDragActive ? (
          <div className={styles.dropIndicator} role="status">{messages.composer.dropImages}</div>
        ) : null}
        {attachmentError ? <div className="attachment-error" role="alert">{attachmentError}</div> : null}
        {submissionError ? (
          <div className="attachment-error" role="alert">
            <strong>{messages.composer.submissionFailed}</strong>
            <span>{submissionError}</span>
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="attachment-row" aria-label={messages.composer.pendingAttachments}>
            {attachments.map((attachment) => (
              <article className="attachment-item" key={attachment.id}>
                <img alt={attachment.file.name} src={attachment.previewUrl} />
                <span><strong>{attachment.file.name}</strong><small>{formatAttachmentFileSize(attachment.file.size)}</small></span>
                <button
                  aria-label={messages.composer.removeAttachment(attachment.file.name)}
                  disabled={submitting}
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                ><span aria-hidden="true">×</span></button>
              </article>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textInput}
          aria-label={messages.composer.inputLabel}
          disabled={submitting}
          value={text}
          placeholder={streaming
            ? messages.composer.streamingPlaceholder
            : messages.composer.idlePlaceholder}
          onChange={(event) => {
            submissionIdRef.current = undefined;
            setSubmissionError(undefined);
            setText(event.target.value);
          }}
          onPaste={(event) => {
            const files = filesFromTransfer(event.clipboardData);
            if (files.length === 0) return;
            event.preventDefault();
            addAttachments(files);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter"
              && !event.shiftKey
              && !isImeConfirmationKey(event.nativeEvent)
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className={`composer-toolbar ${styles.toolbar}`}>
          <div className={`composer-tools ${styles.tools}`}>
            <input
              ref={fileInput}
              aria-label={messages.composer.chooseImageAttachment}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={submitting}
              multiple
              onChange={(event) => {
                const input = event.currentTarget;
                addAttachments(input.files ?? []);
                input.value = "";
              }}
            />
            <Button className={`icon-button ${styles.attachmentButton}`} aria-label={messages.composer.addImage} isDisabled={submitting} onPress={() => fileInput.current?.click()}><ImagePlus size={16} /></Button>
            {streaming ? (
              <div className={`stream-mode ${styles.streamMode}`} aria-label={messages.composer.streamingDelivery}>
                <button
                  aria-pressed={streamBehavior === "steer"}
                  className={streamBehavior === "steer" ? "is-active" : ""}
                  disabled={submitting}
                  title={messages.composer.steerDetail}
                  type="button"
                  onClick={() => {
                    submissionIdRef.current = undefined;
                    setSubmissionError(undefined);
                    setStreamBehavior("steer");
                  }}
                ><ArrowUp size={13} />{messages.composer.steer}</button>
                <button
                  aria-pressed={streamBehavior === "followUp"}
                  className={streamBehavior === "followUp" ? "is-active" : ""}
                  disabled={submitting}
                  title={messages.composer.followUpDetail}
                  type="button"
                  onClick={() => {
                    submissionIdRef.current = undefined;
                    setSubmissionError(undefined);
                    setStreamBehavior("followUp");
                  }}
                ><ListPlus size={13} />{messages.composer.followUp}</button>
              </div>
            ) : <span className={`composer-hint ${styles.hint}`}>{messages.composer.keyboardHint}</span>}
          </div>
          <div className={`composer-actions ${styles.actions}`}>
            <ComposerRuntimeControls submitting={submitting} />
            <Button className="send-button" isDisabled={!canSend} onPress={() => void submit()}>
              <Send size={15} />{submitting ? messages.composer.sending : messages.composer.send}
            </Button>
          </div>
        </div>
      </div>
      <ExtensionWidgets items={widgetItems} placement="belowEditor" />
    </footer>
  );
}
