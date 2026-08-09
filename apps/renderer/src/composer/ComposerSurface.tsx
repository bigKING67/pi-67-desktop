import type { ComposerWorkspaceFileRef, WorkspaceFileEntry } from "@pi67/domain";
import { Send, Square } from "lucide-react";
import {
  lazy,
  Suspense,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from "react";
import { Button } from "react-aria-components";
import type { ExtensionWidgetItem } from "../extension-ui/extension-ui-state.js";
import { messages } from "../localization/message-catalog.js";
import { abortActiveOperation } from "../operation/operation-controller.js";
import type { TaskDraft } from "../workbench/task-draft-store.js";
import { AttachmentPreviewLoading } from "./AttachmentPreviewLoading.js";
import { ComposerAttachmentAction } from "./ComposerAttachmentAction.js";
import { ComposerContextPressure } from "./ComposerContextPressure.js";
import { ComposerInteractionModeControl } from "./ComposerInteractionModeControl.js";
import styles from "./Composer.module.css";
import { ComposerQueuePanel } from "./ComposerQueuePanel.js";
import { ComposerRuntimeControls } from "./ComposerRuntimeControls.js";
import { ComposerReviewContextChips } from "./ComposerReviewContextChips.js";
import { ComposerStreamModeControl } from "./ComposerStreamModeControl.js";
import { ComposerTextarea } from "./ComposerTextarea.js";
import { ComposerWorkspaceContextChips } from "./ComposerWorkspaceContextChips.js";
import { ExtensionWidgets } from "./ExtensionWidgets.js";
import { PromptStashControl } from "./PromptStashControl.js";
import { ToolModeSelector } from "./ToolModeSelector.js";
import {
  filesFromTransfer,
  transferContainsFiles
} from "./composer-attachments.js";
import type { ComposerFileMentionQuery } from "./composer-file-mentions.js";
import type { ComposerSlashItem } from "./composer-slash-commands.js";
import {
  readWorkspaceFileDragData,
  transferContainsWorkspaceFile
} from "./workspace-file-drag.js";
import type { ComposerSlashCatalogState } from "./use-composer-slash-catalog.js";
import type { WorkspaceFileMentionPickerState } from "./WorkspaceFileMentionPicker.js";
import { WorkspaceFileMentionPicker } from "./WorkspaceFileMentionPicker.js";

const AttachmentPreview = lazy(() => import("../attachments/AttachmentPreview.js").then((module) => ({
  default: module.AttachmentPreview
})));
const SlashCommandPicker = lazy(() => import("./SlashCommandPicker.js").then((module) => ({
  default: module.SlashCommandPicker
})));

interface ComposerSurfaceProps {
  activeOperation: boolean;
  activeSessionAuthority: boolean;
  activeStreaming: boolean;
  activeTaskId: string | undefined;
  activeWorkspaceId: string | undefined;
  attachmentDragActive: boolean;
  attachmentDragDepth: RefObject<number>;
  attachmentError: string | undefined;
  canSend: boolean;
  canStop: boolean;
  changingInteractionMode: boolean;
  draft: TaskDraft;
  fileActiveIndex: number;
  fileInput: RefObject<HTMLInputElement | null>;
  fileMentionDismissKey: string;
  fileMentionQuery: ComposerFileMentionQuery | undefined;
  fileMentionSearch: WorkspaceFileMentionPickerState;
  filePickerOpen: boolean;
  hasDraft: boolean;
  interactionMode: "execute" | "plan";
  sessionTransitionPending: boolean;
  slashActiveIndex: number;
  slashCatalog: ComposerSlashCatalogState;
  slashCommands: readonly ComposerSlashItem[];
  slashPickerOpen: boolean;
  stagingAttachments: boolean;
  submissionError: string | undefined;
  submitting: boolean;
  textInput: RefObject<HTMLTextAreaElement | null>;
  widgetItems: ExtensionWidgetItem[];
  onAddAttachments: (files: Iterable<File>) => void;
  onDroppedWorkspaceFile: (reference: ComposerWorkspaceFileRef) => void;
  onFileSelect: (entry: WorkspaceFileEntry) => void;
  onInteractionModeChange: (mode: "execute" | "plan") => void;
  onRemoveAttachment: (id: string) => void;
  onRemoveWorkspaceFile: (reference: ComposerWorkspaceFileRef) => void;
  onSlashComplete: (command: ComposerSlashItem) => void;
  onStreamBehaviorChange: (mode: "steer" | "followUp") => void;
  onSubmit: () => void;
  onTextChange: (value: string, cursor: number) => void;
  setAttachmentDragActive: Dispatch<SetStateAction<boolean>>;
  setDismissedFileMention: Dispatch<SetStateAction<string | undefined>>;
  setDismissedSlashDraft: Dispatch<SetStateAction<string | undefined>>;
  setFileActiveIndex: Dispatch<SetStateAction<number>>;
  setSlashActiveIndex: Dispatch<SetStateAction<number>>;
  setTextCursor: Dispatch<SetStateAction<number>>;
}

export function ComposerSurface(props: ComposerSurfaceProps) {
  const disabled = props.submitting || props.stagingAttachments;
  return (
    <footer className={styles.region} data-testid="composer-region">
      <ExtensionWidgets items={props.widgetItems} placement="aboveEditor" />
      {props.activeSessionAuthority ? <ComposerQueuePanel /> : null}
      {props.slashPickerOpen ? (
        <Suspense fallback={null}>
          <SlashCommandPicker
            activeIndex={props.slashActiveIndex}
            commands={props.slashCommands}
            state={props.slashCatalog}
            onActiveIndexChange={props.setSlashActiveIndex}
            onSelect={props.onSlashComplete}
          />
        </Suspense>
      ) : null}
      {props.filePickerOpen && props.fileMentionQuery ? (
        <WorkspaceFileMentionPicker
          activeIndex={props.fileActiveIndex}
          query={props.fileMentionQuery.query}
          state={props.fileMentionSearch}
          onActiveIndexChange={props.setFileActiveIndex}
          onSelect={props.onFileSelect}
        />
      ) : null}
      <div
        className={`${styles.shell} ${props.attachmentDragActive ? styles.dropActive : ""}`}
        data-testid="composer-shell"
        onDragEnter={(event) => {
          if (!transferContainsFiles(event.dataTransfer)
            && !transferContainsWorkspaceFile(event.dataTransfer)) return;
          event.preventDefault();
          props.attachmentDragDepth.current += 1;
          props.setAttachmentDragActive(true);
        }}
        onDragLeave={(event) => {
          if (!transferContainsFiles(event.dataTransfer)
            && !transferContainsWorkspaceFile(event.dataTransfer)) return;
          event.preventDefault();
          props.attachmentDragDepth.current = Math.max(0, props.attachmentDragDepth.current - 1);
          if (props.attachmentDragDepth.current === 0) props.setAttachmentDragActive(false);
        }}
        onDragOver={(event) => {
          if (!transferContainsFiles(event.dataTransfer)
            && !transferContainsWorkspaceFile(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          const workspaceReference = props.activeWorkspaceId
            ? readWorkspaceFileDragData(event.dataTransfer, props.activeWorkspaceId)
            : undefined;
          if (!workspaceReference && !transferContainsFiles(event.dataTransfer)) return;
          event.preventDefault();
          props.attachmentDragDepth.current = 0;
          props.setAttachmentDragActive(false);
          if (workspaceReference) props.onDroppedWorkspaceFile(workspaceReference);
          else props.onAddAttachments(filesFromTransfer(event.dataTransfer));
        }}
      >
        {props.attachmentDragActive ? (
          <div className={styles.dropIndicator} role="status">{messages.composer.dropAttachments}</div>
        ) : null}
        {props.attachmentError ? <div className={styles.attachmentError} role="alert">{props.attachmentError}</div> : null}
        {props.submissionError ? (
          <div className={styles.attachmentError} role="alert">
            <strong>{messages.composer.submissionFailed}</strong>
            <span>{props.submissionError}</span>
          </div>
        ) : null}
        {props.draft.attachments.length > 0 ? (
          <div className={styles.attachmentRow} aria-label={messages.composer.pendingAttachments}>
            <Suspense fallback={<AttachmentPreviewLoading />}>
              {props.draft.attachments.map((attachment) => (
                <AttachmentPreview
                  attachment={attachment}
                  disabled={disabled}
                  key={attachment.id}
                  removeLabel={messages.composer.removeAttachment(attachment.name)}
                  onRemove={() => props.onRemoveAttachment(attachment.id)}
                />
              ))}
            </Suspense>
          </div>
        ) : null}
        <ComposerWorkspaceContextChips
          disabled={disabled}
          references={props.draft.workspaceFiles}
          onRemove={props.onRemoveWorkspaceFile}
        />
        <ComposerReviewContextChips
          comments={props.draft.reviewComments}
          disabled={disabled}
          taskId={props.activeTaskId}
        />
        <ComposerTextarea
          disabled={props.submitting}
          inputRef={props.textInput}
          fileActiveIndex={props.fileActiveIndex}
          fileEntries={props.fileMentionSearch.entries}
          filePickerOpen={props.filePickerOpen}
          slashActiveIndex={props.slashActiveIndex}
          slashCatalog={props.slashCatalog.catalog}
          slashCommands={props.slashCommands}
          slashPickerOpen={props.slashPickerOpen}
          streaming={props.activeStreaming}
          text={props.draft.text}
          onAddAttachments={props.onAddAttachments}
          onCursorChange={props.setTextCursor}
          onFileActiveIndexChange={props.setFileActiveIndex}
          onFileComplete={props.onFileSelect}
          onFileDismiss={() => props.setDismissedFileMention(props.fileMentionDismissKey)}
          onSlashActiveIndexChange={props.setSlashActiveIndex}
          onSlashComplete={props.onSlashComplete}
          onSlashDismiss={() => props.setDismissedSlashDraft(props.draft.text)}
          onSubmit={props.onSubmit}
          onTextChange={props.onTextChange}
        />
        <div className={styles.toolbar}>
          <div className={styles.tools}>
            <ComposerAttachmentAction
              disabled={disabled}
              inputRef={props.fileInput}
              onAdd={props.onAddAttachments}
            />
            {props.activeTaskId ? (
              <PromptStashControl
                attachments={props.draft.attachments}
                disabled={disabled}
                items={props.draft.promptStash}
                taskId={props.activeTaskId}
                text={props.draft.text}
                workspaceFileCount={props.draft.workspaceFiles.length}
                workspaceId={props.activeWorkspaceId}
                onRestored={(restoredText) => {
                  props.setTextCursor(restoredText.length);
                  requestAnimationFrame(() => {
                    props.textInput.current?.focus();
                    props.textInput.current?.setSelectionRange(restoredText.length, restoredText.length);
                  });
                }}
              />
            ) : null}
            <ToolModeSelector />
            <ComposerInteractionModeControl
              disabled={props.submitting || props.changingInteractionMode
                || props.sessionTransitionPending || props.activeOperation}
              mode={props.interactionMode}
              onChange={props.onInteractionModeChange}
            />
            {props.activeStreaming ? (
              <ComposerStreamModeControl
                disabled={props.submitting}
                mode={props.draft.streamBehavior}
                onChange={props.onStreamBehaviorChange}
              />
            ) : null}
          </div>
          <div className={styles.actions}>
            {props.activeSessionAuthority ? <ComposerContextPressure /> : null}
            {props.activeSessionAuthority ? <ComposerRuntimeControls submitting={props.submitting} /> : null}
            {!props.canStop || props.hasDraft ? (
              <Button
                className={`${styles.sendButton} ${props.canStop ? styles.secondarySendButton : ""}`}
                isDisabled={!props.canSend}
                onPress={props.onSubmit}
              >
                <Send size={15} />{props.submitting ? messages.composer.sending : messages.composer.send}
              </Button>
            ) : null}
            {props.canStop ? (
              <Button className={styles.stopButton!} onPress={() => void abortActiveOperation()}>
                <Square aria-hidden="true" size={12} />{messages.common.stop}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <ExtensionWidgets items={props.widgetItems} placement="belowEditor" />
    </footer>
  );
}
