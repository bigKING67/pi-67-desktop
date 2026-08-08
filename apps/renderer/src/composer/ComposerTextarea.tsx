import type { ClipboardEvent, KeyboardEvent, RefObject } from "react";
import { isImeConfirmationKey } from "../input/ime-keyboard.js";
import { messages } from "../localization/message-catalog.js";
import { filesFromTransfer } from "./composer-attachments.js";
import {
  exactSlashCommand,
  resolveSlashSubmission,
  slashCommandOptionId,
  type ComposerSlashCatalog,
  type ComposerSlashItem
} from "./composer-slash-commands.js";
import { composerFileMentionOptionId } from "./composer-file-mentions.js";
import type { WorkspaceFileEntry } from "@pi67/domain";

export function ComposerTextarea({
  inputRef,
  text,
  disabled,
  streaming,
  slashPickerOpen,
  slashCommands,
  slashActiveIndex,
  slashCatalog,
  filePickerOpen,
  fileEntries,
  fileActiveIndex,
  onTextChange,
  onAddAttachments,
  onSlashActiveIndexChange,
  onSlashComplete,
  onSlashDismiss,
  onFileActiveIndexChange,
  onFileComplete,
  onFileDismiss,
  onCursorChange,
  onSubmit
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  disabled: boolean;
  streaming: boolean;
  slashPickerOpen: boolean;
  slashCommands: readonly ComposerSlashItem[];
  slashActiveIndex: number;
  slashCatalog: ComposerSlashCatalog;
  filePickerOpen: boolean;
  fileEntries: readonly WorkspaceFileEntry[];
  fileActiveIndex: number;
  onTextChange: (text: string, cursor: number) => void;
  onAddAttachments: (files: Iterable<File>) => void;
  onSlashActiveIndexChange: (index: number) => void;
  onSlashComplete: (command: ComposerSlashItem) => void;
  onSlashDismiss: () => void;
  onFileActiveIndexChange: (index: number) => void;
  onFileComplete: (entry: WorkspaceFileEntry) => void;
  onFileDismiss: () => void;
  onCursorChange: (cursor: number) => void;
  onSubmit: () => void;
}) {
  const activeCommand = slashCommands[Math.min(slashActiveIndex, slashCommands.length - 1)];
  const activeFile = fileEntries[Math.min(fileActiveIndex, fileEntries.length - 1)];
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    onAddAttachments(files);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (filePickerOpen && !isImeConfirmationKey(event.nativeEvent)) {
      if (event.key === "ArrowDown" && fileEntries.length > 0) {
        event.preventDefault();
        onFileActiveIndexChange((fileActiveIndex + 1) % fileEntries.length);
        return;
      }
      if (event.key === "ArrowUp" && fileEntries.length > 0) {
        event.preventDefault();
        onFileActiveIndexChange((fileActiveIndex - 1 + fileEntries.length) % fileEntries.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && activeFile) {
        event.preventDefault();
        onFileComplete(activeFile);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onFileDismiss();
        return;
      }
    }
    if (slashPickerOpen && !isImeConfirmationKey(event.nativeEvent)) {
      if (event.key === "ArrowDown" && slashCommands.length > 0) {
        event.preventDefault();
        onSlashActiveIndexChange((slashActiveIndex + 1) % slashCommands.length);
        return;
      }
      if (event.key === "ArrowUp" && slashCommands.length > 0) {
        event.preventDefault();
        onSlashActiveIndexChange((slashActiveIndex - 1 + slashCommands.length) % slashCommands.length);
        return;
      }
      if (event.key === "Enter" && activeCommand) {
        event.preventDefault();
        const route = resolveSlashSubmission(text, slashCatalog);
        if (
          exactSlashCommand(text, slashCatalog)
          || route.kind === "unsupported-pi-builtin"
        ) onSubmit();
        else onSlashComplete(activeCommand);
        return;
      }
      if (event.key === "Tab" && activeCommand) {
        event.preventDefault();
        onSlashComplete(activeCommand);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onSlashDismiss();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !isImeConfirmationKey(event.nativeEvent)) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <textarea
      ref={inputRef}
      aria-activedescendant={filePickerOpen && activeFile
        ? composerFileMentionOptionId(Math.min(fileActiveIndex, fileEntries.length - 1))
        : slashPickerOpen && activeCommand
          ? slashCommandOptionId(Math.min(slashActiveIndex, slashCommands.length - 1))
          : undefined}
      aria-autocomplete="list"
      aria-controls={filePickerOpen
        ? "composer-file-mention-list"
        : slashPickerOpen ? "composer-slash-command-list" : undefined}
      aria-expanded={filePickerOpen || slashPickerOpen}
      aria-label={messages.composer.inputLabel}
      disabled={disabled}
      value={text}
      placeholder={streaming
        ? messages.composer.streamingPlaceholder
        : messages.composer.idlePlaceholder}
      onChange={(event) => onTextChange(event.target.value, event.target.selectionStart)}
      onKeyDown={onKeyDown}
      onSelect={(event) => onCursorChange(event.currentTarget.selectionStart)}
      onPaste={onPaste}
    />
  );
}
