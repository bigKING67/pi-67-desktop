import { ArrowUp, ListPlus, Plus, Send, Square } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionGeneration,
  selectSessionId,
  selectSessionModels
} from "../session/session-projection-selectors.js";
import { useCommittedConversationStreaming } from "../conversation/conversation-store.js";
import { subscribeToComposerPrefill } from "./composer-events.js";
import { submitRendererPrompt } from "./prompt-submission-controller.js";
import { ExtensionWidgets } from "./ExtensionWidgets.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { messages } from "../localization/message-catalog.js";
import styles from "./Composer.module.css";
import {
  filesFromTransfer,
  removeDraftAttachment,
  revokeDraftAttachments,
  stageDraftAttachments,
  transferContainsFiles,
  type DraftAttachment
} from "./composer-attachments.js";
import { ComposerQueuePanel } from "./ComposerQueuePanel.js";
import { ComposerRuntimeControls } from "./ComposerRuntimeControls.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  useWorkbenchStore
} from "../workbench/workbench-store.js";
import { EMPTY_TASK_DRAFT, useTaskDraftStore } from "../workbench/task-draft-store.js";
import { abortActiveOperation } from "../operation/operation-controller.js";
import { invokeRuntimeCommand } from "../operation/operation-controller.js";
import { isActiveOperationLifecycle } from "../operation/operation-lifecycle.js";
import {
  filterSlashCommands,
  insertSlashCommand,
  isSlashInvocation,
  resolveSlashSubmission,
  slashQueryFromDraft
} from "./composer-slash-commands.js";
import { useComposerSlashCatalog } from "./use-composer-slash-catalog.js";
import { ComposerTextarea } from "./ComposerTextarea.js";
import {
  executePiDesktopAction,
  type PiDesktopActionContext
} from "../pi-actions/pi-desktop-actions.js";
import { ToolModeSelector } from "./ToolModeSelector.js";

const AttachmentPreview = lazy(() => import("../attachments/AttachmentPreview.js").then((module) => ({
  default: module.AttachmentPreview
})));
const SlashCommandPicker = lazy(() => import("./SlashCommandPicker.js").then((module) => ({
  default: module.SlashCommandPicker
})));

export function Composer() {
  const sessionId = useSessionProjectionStore(selectSessionId);
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const operation = useAppStore((state) => state.operation);
  const workspace = useAppStore((state) => state.workspace);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const resourcesRevision = useSessionProjectionStore((state) => state.revisions.resources);
  const models = useSessionProjectionStore(selectSessionModels) ?? [];
  const sessionReady = useSessionProjectionStore((state) => state.authority.phase === "active");
  const widgets = useExtensionUiStore((state) => state.widgets);
  const activeTaskId = useWorkbenchStore((state) => selectedWorkbenchTask(state)?.id);
  const draft = useTaskDraftStore((state) => (
    activeTaskId ? state.drafts[activeTaskId] ?? EMPTY_TASK_DRAFT : EMPTY_TASK_DRAFT
  ));
  const text = draft.text;
  const attachments = draft.attachments;
  const streamBehavior = draft.streamBehavior;
  const [attachmentError, setAttachmentError] = useState<string>();
  const [submissionError, setSubmissionError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [stagingAttachments, setStagingAttachments] = useState(false);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [dismissedSlashDraft, setDismissedSlashDraft] = useState<string>();
  const attachmentDragDepth = useRef(0);
  const submissionIdRef = useRef<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const streaming = useCommittedConversationStreaming();
  const hasDraft = text.trim().length > 0 || attachments.length > 0;
  const canSend = !submitting && !stagingAttachments && hasDraft;
  const canStop = Boolean(
    operation?.cancellable
    && isActiveOperationLifecycle(operation.lifecycle)
    && operation.sessionId === sessionId
    && operation.sessionGeneration === sessionGeneration
  );
  const widgetItems = Object.values(widgets);
  const slashCatalog = useComposerSlashCatalog({ connected, hostEpoch, resourcesRevision, sessionId });
  const slashQuery = useMemo(() => slashQueryFromDraft(text), [text]);
  const slashCommands = useMemo(() => (
    slashQuery
      ? filterSlashCommands(slashCatalog.catalog, slashQuery)
      : []
  ), [slashCatalog, slashQuery]);
  const slashPickerOpen = slashQuery !== undefined && dismissedSlashDraft !== text;
  const piDesktopActionContext: PiDesktopActionContext = {
    connected,
    workspaceAvailable: Boolean(workspace),
    sessionReady,
    sessionTransitionPending,
    activeOperation: Boolean(operation && isActiveOperationLifecycle(operation.lifecycle)),
    configuredModels: models
  };

  const setText = (value: string) => {
    if (activeTaskId) useTaskDraftStore.getState().setText(activeTaskId, value);
  };
  const setAttachments = (value: DraftAttachment[] | ((current: DraftAttachment[]) => DraftAttachment[])) => {
    if (!activeTaskId) return;
    const current = useTaskDraftStore.getState().drafts[activeTaskId]?.attachments ?? [];
    useTaskDraftStore.getState().setAttachments(
      activeTaskId,
      typeof value === "function" ? value(current) : value
    );
  };
  const setStreamBehavior = (value: "steer" | "followUp") => {
    if (activeTaskId) useTaskDraftStore.getState().setStreamBehavior(activeTaskId, value);
  };

  useEffect(() => subscribeToComposerPrefill((nextText) => {
    submissionIdRef.current = undefined;
    setText(nextText);
    requestAnimationFrame(() => textInput.current?.focus());
  }), []);

  useEffect(() => {
    submissionIdRef.current = undefined;
  }, [hostEpoch, sessionGeneration, sessionId]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashCatalog.runtimeStatus, text]);

  useEffect(() => {
    if (!activeTaskId) return;
    rendererWorkbenchStore.getState().updateTask(activeTaskId, {
      hasDraft: text.trim().length > 0,
      attachmentCount: attachments.length
    });
  }, [activeTaskId, attachments.length, text]);

  const submit = async () => {
    if (!canSend || !activeTaskId) return;
    const nextText = text.trim();
    const nextAttachments = attachments;
    if (isSlashInvocation(nextText)) {
      const slashRoute = resolveSlashSubmission(nextText, slashCatalog.catalog);
      if (slashRoute.kind === "desktop-action") {
        setSubmitting(true);
        setSubmissionError(undefined);
        try {
          const result = await executePiDesktopAction(
            slashRoute.action,
            slashRoute.arguments,
            piDesktopActionContext
          );
          if (result.status === "blocked") {
            setSubmissionError(result.message);
            return;
          }
          setText("");
          submissionIdRef.current = undefined;
        } catch (error) {
          setSubmissionError(error instanceof Error ? error.message : messages.composer.commandFailed);
        } finally {
          setSubmitting(false);
        }
        return;
      }
      if (slashRoute.kind === "unsupported-pi-builtin") {
        setDismissedSlashDraft(nextText);
        setSubmissionError(messages.composer.unsupportedPiBuiltin(slashRoute.name));
        return;
      }
      if (slashRoute.kind === "extension") {
        if (streaming) {
          setSubmissionError(messages.composer.commandUnavailableWhileRunning);
          return;
        }
        if (nextAttachments.length > 0) {
          setSubmissionError(messages.composer.commandAttachmentsUnsupported);
          return;
        }
        setSubmitting(true);
        setSubmissionError(undefined);
        try {
          const submissionId = submissionIdRef.current ?? crypto.randomUUID();
          submissionIdRef.current = submissionId;
          if (!await invokeRuntimeCommand(slashRoute.command, submissionId)) {
            setSubmissionError(messages.composer.commandFailed);
            return;
          }
          setText("");
          submissionIdRef.current = undefined;
        } finally {
          setSubmitting(false);
        }
        return;
      }
    }
    setSubmitting(true);
    setSubmissionError(undefined);
    try {
      const submissionId = submissionIdRef.current ?? crypto.randomUUID();
      submissionIdRef.current = submissionId;
      const result = await submitRendererPrompt(
        nextText,
        streaming ? streamBehavior : "send",
        submissionId,
        nextAttachments
      );
      if (!result.accepted) {
        setSubmissionError(result.error);
        return;
      }
      setText("");
      submissionIdRef.current = undefined;
      if (!result.retainsAttachmentPreviews) revokeDraftAttachments(nextAttachments);
      useTaskDraftStore.getState().setAttachments(activeTaskId, []);
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

  const addAttachments = async (files: Iterable<File>) => {
    if (stagingAttachments) return;
    setAttachmentError(undefined);
    setStagingAttachments(true);
    try {
      submissionIdRef.current = undefined;
      setSubmissionError(undefined);
      const current = activeTaskId
        ? useTaskDraftStore.getState().drafts[activeTaskId]?.attachments ?? []
        : [];
      setAttachments(await stageDraftAttachments(files, current));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : messages.composer.selectedAttachmentReadFailed);
    } finally {
      setStagingAttachments(false);
    }
  };

  return (
    <footer className={styles.region} data-testid="composer-region">
      <ExtensionWidgets items={widgetItems} placement="aboveEditor" />
      <ComposerQueuePanel />
      {slashPickerOpen ? (
        <Suspense fallback={null}>
          <SlashCommandPicker
            activeIndex={slashActiveIndex}
            commands={slashCommands}
            state={slashCatalog}
            onActiveIndexChange={setSlashActiveIndex}
            onSelect={(command) => {
              submissionIdRef.current = undefined;
              setSubmissionError(undefined);
              setDismissedSlashDraft(undefined);
              setText(insertSlashCommand(text, command));
              requestAnimationFrame(() => textInput.current?.focus());
            }}
          />
        </Suspense>
      ) : null}
      <div
        className={`${styles.shell} ${attachmentDragActive ? styles.dropActive : ""}`}
        data-testid="composer-shell"
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
          void addAttachments(filesFromTransfer(event.dataTransfer));
        }}
      >
        {attachmentDragActive ? (
          <div className={styles.dropIndicator} role="status">{messages.composer.dropAttachments}</div>
        ) : null}
        {attachmentError ? <div className={styles.attachmentError} role="alert">{attachmentError}</div> : null}
        {submissionError ? (
          <div className={styles.attachmentError} role="alert">
            <strong>{messages.composer.submissionFailed}</strong>
            <span>{submissionError}</span>
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className={styles.attachmentRow} aria-label={messages.composer.pendingAttachments}>
            <Suspense fallback={<AttachmentPreviewLoading />}>
              {attachments.map((attachment) => (
                <AttachmentPreview
                  attachment={attachment}
                  disabled={submitting || stagingAttachments}
                  key={attachment.id}
                  removeLabel={messages.composer.removeAttachment(attachment.name)}
                  onRemove={() => removeAttachment(attachment.id)}
                />
              ))}
            </Suspense>
          </div>
        ) : null}
        <ComposerTextarea
          disabled={submitting}
          inputRef={textInput}
          slashActiveIndex={slashActiveIndex}
          slashCatalog={slashCatalog.catalog}
          slashCommands={slashCommands}
          slashPickerOpen={slashPickerOpen}
          streaming={streaming}
          text={text}
          onAddAttachments={(files) => void addAttachments(files)}
          onSlashActiveIndexChange={setSlashActiveIndex}
          onSlashComplete={(command) => {
            submissionIdRef.current = undefined;
            setSubmissionError(undefined);
            setText(insertSlashCommand(text, command));
          }}
          onSlashDismiss={() => setDismissedSlashDraft(text)}
          onSubmit={() => void submit()}
          onTextChange={(value) => {
            submissionIdRef.current = undefined;
            setSubmissionError(undefined);
            setDismissedSlashDraft(undefined);
            setText(value);
          }}
        />
        <div className={styles.toolbar}>
          <div className={styles.tools}>
            <input
              ref={fileInput}
              aria-label={messages.composer.chooseAttachment}
              className="sr-only"
              type="file"
              disabled={submitting || stagingAttachments}
              multiple
              onChange={(event) => {
                const input = event.currentTarget;
                void addAttachments(input.files ?? []);
                input.value = "";
              }}
            />
            <Button className={`icon-button ${styles.attachmentButton}`} aria-label={messages.composer.addAttachment} isDisabled={submitting || stagingAttachments} onPress={() => fileInput.current?.click()}><Plus size={17} /></Button>
            <ToolModeSelector />
            {streaming ? (
              <div className={styles.streamMode} aria-label={messages.composer.streamingDelivery}>
                <button
                  aria-pressed={streamBehavior === "steer"}
                  className={streamBehavior === "steer" ? styles.streamModeActive : ""}
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
                  className={streamBehavior === "followUp" ? styles.streamModeActive : ""}
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
            ) : null}
          </div>
          <div className={styles.actions}>
            <ComposerRuntimeControls submitting={submitting} />
            {!canStop || hasDraft ? (
              <Button
                className={`${styles.sendButton} ${canStop ? styles.secondarySendButton : ""}`}
                isDisabled={!canSend}
                onPress={() => void submit()}
              >
                <Send size={15} />{submitting ? messages.composer.sending : messages.composer.send}
              </Button>
            ) : null}
            {canStop ? (
              <Button className={styles.stopButton!} onPress={() => void abortActiveOperation()}>
                <Square aria-hidden="true" size={12} />{messages.common.stop}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <ExtensionWidgets items={widgetItems} placement="belowEditor" />
    </footer>
  );
}

function AttachmentPreviewLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="正在加载附件预览"
      role="status"
      style={{ display: "grid", width: 218, height: 56, flex: "0 0 auto", placeItems: "center" }}
    >
      <span className="loading-line" />
    </div>
  );
}
