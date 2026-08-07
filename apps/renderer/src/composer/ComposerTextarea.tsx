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

export function ComposerTextarea({
  inputRef,
  text,
  disabled,
  streaming,
  slashPickerOpen,
  slashCommands,
  slashActiveIndex,
  slashCatalog,
  onTextChange,
  onAddAttachments,
  onSlashActiveIndexChange,
  onSlashComplete,
  onSlashDismiss,
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
  onTextChange: (text: string) => void;
  onAddAttachments: (files: Iterable<File>) => void;
  onSlashActiveIndexChange: (index: number) => void;
  onSlashComplete: (command: ComposerSlashItem) => void;
  onSlashDismiss: () => void;
  onSubmit: () => void;
}) {
  const activeCommand = slashCommands[Math.min(slashActiveIndex, slashCommands.length - 1)];
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    onAddAttachments(files);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
      aria-activedescendant={slashPickerOpen && activeCommand
        ? slashCommandOptionId(Math.min(slashActiveIndex, slashCommands.length - 1))
        : undefined}
      aria-autocomplete="list"
      aria-controls={slashPickerOpen ? "composer-slash-command-list" : undefined}
      aria-expanded={slashPickerOpen}
      aria-label={messages.composer.inputLabel}
      disabled={disabled}
      value={text}
      placeholder={streaming
        ? messages.composer.streamingPlaceholder
        : messages.composer.idlePlaceholder}
      onChange={(event) => onTextChange(event.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    />
  );
}
