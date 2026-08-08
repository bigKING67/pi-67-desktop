import type { WorkspaceFileEntry } from "@pi67/domain";
import { File, LoaderCircle } from "lucide-react";
import { composerFileMentionOptionId } from "./composer-file-mentions.js";
import styles from "./WorkspaceFileMentionPicker.module.css";

export interface WorkspaceFileMentionPickerState {
  status: "idle" | "loading" | "ready" | "failed";
  entries: readonly WorkspaceFileEntry[];
  truncated: boolean;
  error?: string;
}

export function WorkspaceFileMentionPicker({
  query,
  state,
  activeIndex,
  onActiveIndexChange,
  onSelect
}: {
  query: string;
  state: WorkspaceFileMentionPickerState;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (entry: WorkspaceFileEntry) => void;
}) {
  return (
    <div className={styles.anchor}>
      <div className={styles.picker} data-testid="composer-file-mention-picker">
        <header><strong>引用工作区文件</strong><span>@{query}</span></header>
        {state.status === "loading" ? (
          <p role="status"><LoaderCircle className={styles.spin} size={14} />正在搜索文件</p>
        ) : state.status === "failed" ? (
          <p role="alert">{state.error ?? "文件搜索失败，请重试。"}</p>
        ) : query.length === 0 ? (
          <p>继续输入文件名或相对路径。</p>
        ) : state.entries.length === 0 ? (
          <p>没有匹配的普通文件。</p>
        ) : (
          <div className={styles.list} id="composer-file-mention-list" role="listbox">
            {state.entries.map((entry, index) => (
              <button
                aria-selected={index === activeIndex}
                className={index === activeIndex ? styles.active : undefined}
                id={composerFileMentionOptionId(index)}
                key={`${entry.id}:${entry.revision}`}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onActiveIndexChange(index)}
                onClick={() => onSelect(entry)}
              >
                <File aria-hidden="true" size={14} />
                <span><strong>{entry.name}</strong><small>{entry.relativePath}</small></span>
              </button>
            ))}
          </div>
        )}
        {state.truncated ? <footer>结果已达上限，继续输入可缩小范围。</footer> : null}
      </div>
    </div>
  );
}
