import { Command, FileText, Sparkles } from "lucide-react";
import { messages } from "../localization/message-catalog.js";
import {
  slashCommandOptionId,
  type ComposerSlashItem
} from "./composer-slash-commands.js";
import type { ComposerSlashCatalogState } from "./use-composer-slash-catalog.js";
import styles from "./SlashCommandPicker.module.css";

const SOURCE_ORDER: readonly ComposerSlashItem["source"][] = [
  "desktop-action",
  "extension",
  "prompt",
  "skill"
];

export function SlashCommandPicker({
  state,
  commands,
  activeIndex,
  onActiveIndexChange,
  onSelect
}: {
  state: ComposerSlashCatalogState;
  commands: readonly ComposerSlashItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (command: ComposerSlashItem) => void;
}) {
  return (
    <div className={styles.slashPickerAnchor}>
      <div className={styles.slashPicker} data-testid="composer-slash-picker">
        <header>
          <strong>{messages.composer.slashPickerTitle}</strong>
          <span>{messages.composer.slashPickerFilterHint}</span>
        </header>
        {commands.length > 0 ? (
          <div className={styles.slashCommandList} id="composer-slash-command-list" role="listbox">
            {SOURCE_ORDER.map((source) => {
              const firstIndex = commands.findIndex((command) => command.source === source);
              if (firstIndex < 0) return null;
              const sourceCommands = commands.filter((command) => command.source === source);
              const headingId = `composer-slash-group-${source}`;
              return (
                <div aria-labelledby={headingId} className={styles.slashCommandGroup} key={source} role="group">
                  <div className={styles.slashCommandGroupHeading} id={headingId}>{sourceLabel(source)}</div>
                  {sourceCommands.map((command) => {
                    const index = commands.indexOf(command);
                    const Icon = command.source === "desktop-action"
                      ? command.icon
                      : command.source === "extension"
                        ? Command
                        : command.source === "prompt"
                          ? FileText
                          : Sparkles;
                    return (
                      <button
                        aria-selected={index === activeIndex}
                        className={index === activeIndex ? styles.slashCommandActive : undefined}
                        id={slashCommandOptionId(index)}
                        key={`${command.source}:${command.name}`}
                        role="option"
                        type="button"
                        onMouseEnter={() => onActiveIndexChange(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onSelect(command)}
                      >
                        <Icon aria-hidden="true" size={15} />
                        <span>
                          <strong>/{command.name}{command.source === "desktop-action" && command.argumentHint
                            ? ` ${command.argumentHint}`
                            : ""}</strong>
                          <small>{command.description ?? sourceLabel(command.source)}</small>
                        </span>
                        <em>{sourceLabel(command.source)}</em>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : <p>{messages.composer.slashEmpty}</p>}
        {state.runtimeStatus === "loading" ? (
          <p className={styles.slashRuntimeStatus} role="status">{messages.composer.slashRuntimeLoading}</p>
        ) : null}
        {state.runtimeStatus === "failed" ? (
          <p className={styles.slashRuntimeStatus} role="alert">{messages.composer.slashRuntimeFailed}</p>
        ) : null}
        {state.runtimeStatus === "unavailable" ? (
          <p className={styles.slashRuntimeStatus} role="status">{messages.composer.slashRuntimeUnavailable}</p>
        ) : null}
        {state.catalog.truncated ? <footer>扩展目录较多，继续输入名称可缩小范围。</footer> : null}
      </div>
    </div>
  );
}

function sourceLabel(source: ComposerSlashItem["source"]): string {
  if (source === "desktop-action") return messages.composer.slashGroups.builtin;
  if (source === "extension") return messages.composer.slashGroups.extension;
  if (source === "prompt") return messages.composer.slashGroups.prompt;
  return messages.composer.slashGroups.skill;
}
