import type { ComposerWorkspaceFileRef, WorkspaceFileEntry } from "@pi67/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectInteractionMode, selectSessionFileIdentity, selectSessionGeneration, selectSessionId, selectSessionModels
} from "../session/session-projection-selectors.js";
import { useCommittedConversationStreaming } from "../conversation/conversation-store.js";
import { subscribeToComposerPrefill } from "./composer-events.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { messages } from "../localization/message-catalog.js";
import {
  removeDraftAttachment,
  stageDraftAttachments
} from "./composer-attachments.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  useWorkbenchStore
} from "../workbench/workbench-store.js";
import { EMPTY_TASK_DRAFT, useTaskDraftStore } from "../workbench/task-draft-store.js";
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
import { executePiDesktopAction, type PiDesktopActionContext } from "../pi-actions/pi-desktop-actions.js";
import { setRendererSessionInteractionMode } from "../session/session-plan-controller.js";
import {
  composerFileMentionQuery,
  insertComposerFileMention,
  insertComposerFileMentionAtCursor,
  mergeComposerFileReference,
  removeComposerFileReference,
  referencesPresentInComposerText
} from "./composer-file-mentions.js";
import { useComposerFileMentionSearch } from "./use-composer-file-mention-search.js";
import { ComposerSurface } from "./ComposerSurface.js";
import { prepareComposerReviewSubmission } from "../changes/change-review-controller.js";
import { clearAcceptedComposerDraft, submitComposerDraft } from "./composer-submission-controller.js";
import { composerDraftActions } from "./composer-draft-actions.js";

export function Composer() {
  const sessionId = useSessionProjectionStore(selectSessionId);
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const operation = useAppStore((state) => state.operation);
  const workspace = useAppStore((state) => state.workspace);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const sessionFileIdentity = useSessionProjectionStore(selectSessionFileIdentity);
  const resourcesRevision = useSessionProjectionStore((state) => state.revisions.resources);
  const models = useSessionProjectionStore(selectSessionModels) ?? [];
  const authoritativeInteractionMode = useSessionProjectionStore(selectInteractionMode);
  const sessionReady = useSessionProjectionStore((state) => state.authority.phase === "active");
  const widgets = useExtensionUiStore((state) => state.widgets);
  const activeTask = useWorkbenchStore(selectedWorkbenchTask);
  const activeTaskId = activeTask?.id;
  const activeWorkspace = useWorkbenchStore((state) => {
    const selected = selectedWorkbenchTask(state);
    return selected ? state.workspaces[selected.workspaceId] : undefined;
  });
  const draft = useTaskDraftStore((state) => (
    activeTaskId ? state.drafts[activeTaskId] ?? EMPTY_TASK_DRAFT : EMPTY_TASK_DRAFT
  ));
  const text = draft.text;
  const attachments = draft.attachments;
  const workspaceFiles = draft.workspaceFiles;
  const reviewComments = draft.reviewComments;
  const streamBehavior = draft.streamBehavior;
  const [attachmentError, setAttachmentError] = useState<string>();
  const [submissionError, setSubmissionError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [stagingAttachments, setStagingAttachments] = useState(false);
  const [changingInteractionMode, setChangingInteractionMode] = useState(false);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [fileActiveIndex, setFileActiveIndex] = useState(0);
  const [textCursor, setTextCursor] = useState(0);
  const [dismissedSlashDraft, setDismissedSlashDraft] = useState<string>();
  const [dismissedFileMention, setDismissedFileMention] = useState<string>();
  const attachmentDragDepth = useRef(0);
  const submissionIdRef = useRef<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const streaming = useCommittedConversationStreaming();
  const activeSessionAuthority = Boolean(
    activeTask?.conversation.kind === "session"
    && sessionReady
    && activeTask.sessionId === sessionId
    && activeTask.sessionFileIdentity === sessionFileIdentity
    && activeTask.sessionGeneration === sessionGeneration
  );
  const interactionMode = activeSessionAuthority
    ? authoritativeInteractionMode
    : draft.interactionMode;
  const activeStreaming = activeSessionAuthority && streaming;
  const hasDraft = text.trim().length > 0
    || attachments.length > 0
    || workspaceFiles.length > 0
    || reviewComments.length > 0;
  const canSend = !submitting && !stagingAttachments && hasDraft;
  const activeOperation = Boolean(
    activeSessionAuthority
    && operation
    && isActiveOperationLifecycle(operation.lifecycle)
  );
  const canStop = Boolean(
    activeSessionAuthority
    && operation?.cancellable
    && isActiveOperationLifecycle(operation.lifecycle)
    && operation.sessionId === sessionId
    && operation.sessionGeneration === sessionGeneration
  );
  const widgetItems = activeSessionAuthority ? Object.values(widgets) : [];
  const slashCatalog = useComposerSlashCatalog({
    connected,
    hostEpoch,
    resourcesRevision,
    sessionId: activeSessionAuthority ? sessionId : undefined
  });
  const slashQuery = useMemo(() => slashQueryFromDraft(text), [text]);
  const slashCommands = useMemo(() => (
    slashQuery
      ? filterSlashCommands(slashCatalog.catalog, slashQuery)
      : []
  ), [slashCatalog, slashQuery]);
  const slashPickerOpen = slashQuery !== undefined && dismissedSlashDraft !== text;
  const fileMentionQuery = useMemo(
    () => composerFileMentionQuery(text, textCursor),
    [text, textCursor]
  );
  const fileMentionDismissKey = `${text}\0${textCursor}`;
  const filePickerOpen = fileMentionQuery !== undefined
    && !slashPickerOpen
    && dismissedFileMention !== fileMentionDismissKey;
  const fileMentionSearch = useComposerFileMentionSearch(
    activeWorkspace,
    filePickerOpen ? fileMentionQuery?.query : undefined,
    hostEpoch
  );
  const piDesktopActionContext: PiDesktopActionContext = {
    connected,
    workspaceAvailable: Boolean(workspace),
    sessionReady: activeSessionAuthority,
    sessionTransitionPending,
    activeOperation,
    configuredModels: models
  };
  const { setText, setAttachments, setWorkspaceFiles, setStreamBehavior } = useMemo(
    () => composerDraftActions(activeTaskId),
    [activeTaskId]
  );
  const setInteractionMode = async (mode: "execute" | "plan") => {
    if (!activeTaskId || mode === interactionMode || changingInteractionMode) return;
    submissionIdRef.current = undefined;
    setSubmissionError(undefined);
    if (!activeSessionAuthority) {
      useTaskDraftStore.getState().setInteractionMode(activeTaskId, mode);
      return;
    }
    setChangingInteractionMode(true);
    try {
      if (!await setRendererSessionInteractionMode(mode)) {
        setSubmissionError("交互模式未能确认，请重试。");
      }
    } finally {
      setChangingInteractionMode(false);
    }
  };
  useEffect(() => subscribeToComposerPrefill((nextText) => {
    submissionIdRef.current = undefined;
    setText(nextText);
    setTextCursor(nextText.length);
    requestAnimationFrame(() => {
      textInput.current?.focus();
      textInput.current?.setSelectionRange(nextText.length, nextText.length);
    });
  }), []);
  useEffect(() => {
    submissionIdRef.current = undefined;
    setAttachmentError(undefined);
    setSubmissionError(undefined);
    setDismissedSlashDraft(undefined);
    setDismissedFileMention(undefined);
    setTextCursor(0);
  }, [activeTaskId, hostEpoch, sessionGeneration, sessionId]);
  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashCatalog.runtimeStatus, text]);
  useEffect(() => {
    setFileActiveIndex(0);
  }, [fileMentionQuery?.query, fileMentionSearch.status]);
  useEffect(() => {
    submissionIdRef.current = undefined;
    setSubmissionError(undefined);
  }, [reviewComments]);

  useEffect(() => {
    if (!activeTaskId) return;
    rendererWorkbenchStore.getState().updateTask(activeTaskId, {
      hasDraft: text.trim().length > 0
        || attachments.length > 0
        || workspaceFiles.length > 0
        || reviewComments.length > 0
        || draft.promptStash.length > 0,
      attachmentCount: attachments.length
    });
  }, [activeTaskId, attachments.length, draft.promptStash.length, reviewComments.length, text, workspaceFiles.length]);
  const submit = async () => {
    if (!canSend || !activeTask || !activeTaskId) return;
    const baseText = text.trim();
    const nextAttachments = attachments;
    const mentionedWorkspaceFiles = referencesPresentInComposerText(baseText, workspaceFiles);
    if (reviewComments.length > 0 && isSlashInvocation(baseText)) {
      setSubmissionError("修改意见不能与 Slash command 同时发送；请改为普通任务说明。");
      return;
    }
    const preparedReview = prepareComposerReviewSubmission(activeTaskId, baseText, mentionedWorkspaceFiles);
    if (!preparedReview.ok) {
      setSubmissionError(preparedReview.message);
      return;
    }
    const nextText = preparedReview.text;
    const nextWorkspaceFiles = preparedReview.workspaceFiles;
    if (isSlashInvocation(nextText)) {
      if (nextWorkspaceFiles.length > 0) {
        setSubmissionError(messages.composer.commandAttachmentsUnsupported);
        return;
      }
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
        if (activeStreaming) {
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
      const result = await submitComposerDraft({
        taskId: activeTask.id,
        provisional: activeTask.conversation.kind === "provisional"
          && activeTask.creationStatus === undefined,
        text: nextText,
        submissionId,
        attachments: nextAttachments,
        workspaceFiles: nextWorkspaceFiles,
        activeStreaming,
        streamBehavior
      });
      if (!result.accepted) {
        setSubmissionError(result.error);
        return;
      }
      clearAcceptedComposerDraft({
        taskId: activeTaskId,
        result,
        attachments: nextAttachments,
        reviewCommentIds: preparedReview.commentIds
      });
      submissionIdRef.current = undefined;
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
  const selectWorkspaceFile = (entry: WorkspaceFileEntry) => {
    if (!fileMentionQuery) return;
    submissionIdRef.current = undefined;
    setSubmissionError(undefined);
    const inserted = insertComposerFileMention(text, fileMentionQuery, entry);
    setText(inserted.text);
    setWorkspaceFiles((current) => mergeComposerFileReference(current, inserted.reference));
    setTextCursor(inserted.cursor);
    setDismissedFileMention(undefined);
    requestAnimationFrame(() => {
      textInput.current?.focus();
      textInput.current?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  };
  const insertDroppedWorkspaceFile = (reference: ComposerWorkspaceFileRef) => {
    submissionIdRef.current = undefined;
    setSubmissionError(undefined);
    const inserted = insertComposerFileMentionAtCursor(text, textCursor, reference);
    setText(inserted.text);
    setWorkspaceFiles((current) => mergeComposerFileReference(current, reference));
    setTextCursor(inserted.cursor);
    requestAnimationFrame(() => {
      textInput.current?.focus();
      textInput.current?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  };
  const removeWorkspaceFile = (reference: ComposerWorkspaceFileRef) => {
    submissionIdRef.current = undefined;
    setSubmissionError(undefined);
    const removed = removeComposerFileReference(text, textCursor, reference);
    setText(removed.text);
    setWorkspaceFiles((current) => current.filter((item) => item.id !== reference.id));
    setTextCursor(removed.cursor);
    requestAnimationFrame(() => {
      textInput.current?.focus();
      textInput.current?.setSelectionRange(removed.cursor, removed.cursor);
    });
  };
  return <ComposerSurface
    activeOperation={activeOperation}
    activeSessionAuthority={activeSessionAuthority}
    activeStreaming={activeStreaming}
    activeTaskId={activeTaskId}
    activeWorkspaceId={activeWorkspace?.id}
    attachmentDragActive={attachmentDragActive}
    attachmentDragDepth={attachmentDragDepth}
    attachmentError={attachmentError}
    canSend={canSend}
    canStop={canStop}
    changingInteractionMode={changingInteractionMode}
    draft={draft}
    fileActiveIndex={fileActiveIndex}
    fileInput={fileInput}
    fileMentionDismissKey={fileMentionDismissKey}
    fileMentionQuery={fileMentionQuery}
    fileMentionSearch={fileMentionSearch}
    filePickerOpen={filePickerOpen}
    hasDraft={hasDraft}
    interactionMode={interactionMode}
    sessionTransitionPending={sessionTransitionPending}
    slashActiveIndex={slashActiveIndex}
    slashCatalog={slashCatalog}
    slashCommands={slashCommands}
    slashPickerOpen={slashPickerOpen}
    stagingAttachments={stagingAttachments}
    submissionError={submissionError}
    submitting={submitting}
    textInput={textInput}
    widgetItems={widgetItems}
    onAddAttachments={(files) => void addAttachments(files)}
    onDroppedWorkspaceFile={insertDroppedWorkspaceFile}
    onFileSelect={selectWorkspaceFile}
    onInteractionModeChange={(mode) => void setInteractionMode(mode)}
    onRemoveAttachment={removeAttachment}
    onRemoveWorkspaceFile={removeWorkspaceFile}
    onSlashComplete={(command) => {
      submissionIdRef.current = undefined;
      setSubmissionError(undefined);
      setDismissedSlashDraft(undefined);
      const nextText = insertSlashCommand(text, command);
      setText(nextText);
      setTextCursor(nextText.length);
      requestAnimationFrame(() => {
        textInput.current?.focus();
        textInput.current?.setSelectionRange(nextText.length, nextText.length);
      });
    }}
    onStreamBehaviorChange={(mode) => {
      submissionIdRef.current = undefined;
      setSubmissionError(undefined);
      setStreamBehavior(mode);
    }}
    onSubmit={() => void submit()}
    onTextChange={(value, cursor) => {
      submissionIdRef.current = undefined;
      setSubmissionError(undefined);
      setDismissedSlashDraft(undefined);
      setDismissedFileMention(undefined);
      setTextCursor(cursor);
      setText(value);
      setWorkspaceFiles((current) => referencesPresentInComposerText(value, current));
    }}
    setAttachmentDragActive={setAttachmentDragActive}
    setDismissedFileMention={setDismissedFileMention}
    setDismissedSlashDraft={setDismissedSlashDraft}
    setFileActiveIndex={setFileActiveIndex}
    setSlashActiveIndex={setSlashActiveIndex}
    setTextCursor={setTextCursor}
  />;
}
