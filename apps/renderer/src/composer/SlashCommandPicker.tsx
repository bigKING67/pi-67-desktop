import type { SlashCommandDescriptor } from "@pi67/protocol";
import { Command, FileText, Sparkles } from "lucide-react";
import type { ComposerSlashCatalogState } from "./use-composer-slash-catalog.js";
import styles from "./Composer.module.css";

export function SlashCommandPicker({
  state,
  commands,
  activeIndex,
  onActiveIndexChange,
  onSelect
}: {
  state: ComposerSlashCatalogState;
  commands: readonly SlashCommandDescriptor[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (command: SlashCommandDescriptor) => void;
}) {
  return (
    <div className={styles.slashPicker} data-testid="composer-slash-picker">
      <header>
        <strong>指令与技能</strong>
        <span>输入名称筛选</span>
      </header>
      {state.status === "loading" ? <p role="status">正在加载 Pi 指令…</p> : null}
      {state.status === "failed" ? <p role="alert">无法加载指令目录，请稍后重试。</p> : null}
      {state.status === "unavailable" ? <p role="status">Pi 运行服务连接后可使用指令。</p> : null}
      {state.status === "ready" && commands.length === 0 ? <p>没有匹配的指令或技能。</p> : null}
      {state.status === "ready" && commands.length > 0 ? (
        <div className={styles.slashCommandList} id="composer-slash-command-list" role="listbox">
          {commands.map((command, index) => {
            const Icon = command.source === "extension" ? Command : command.source === "prompt" ? FileText : Sparkles;
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
                  <strong>/{command.name}</strong>
                  <small>{command.description ?? sourceLabel(command.source)}</small>
                </span>
                <em>{sourceLabel(command.source)}</em>
              </button>
            );
          })}
        </div>
      ) : null}
      {state.status === "ready" && state.catalog.truncated ? (
        <footer>指令较多，当前显示目录的前 {state.catalog.items.length} 项。</footer>
      ) : null}
    </div>
  );
}

export function slashCommandOptionId(index: number): string {
  return `composer-slash-command-${index}`;
}

function sourceLabel(source: SlashCommandDescriptor["source"]): string {
  if (source === "extension") return "指令";
  if (source === "prompt") return "提示词";
  return "技能";
}
