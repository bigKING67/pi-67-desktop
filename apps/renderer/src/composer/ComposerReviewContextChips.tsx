import type { ComposerReviewComment } from "@pi67/domain";
import { MessageSquareText, X } from "lucide-react";
import { reviewAuthorityCurrent } from "../changes/change-review-controller.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import styles from "./Composer.module.css";

export function ComposerReviewContextChips({
  comments,
  disabled,
  taskId
}: {
  comments: readonly ComposerReviewComment[];
  disabled: boolean;
  taskId: string | undefined;
}) {
  if (!taskId || comments.length === 0) return null;
  return (
    <div aria-label="待发送修改意见" className={styles.reviewContextList}>
      {comments.map((comment) => {
        const current = reviewAuthorityCurrent(taskId, comment.authority);
        return (
          <div className={styles.reviewContextChip} data-stale={current ? "false" : "true"} key={comment.id}>
            <MessageSquareText aria-hidden="true" size={13} />
            <span>
              <strong>{fileName(comment.file.relativePath)} · {anchorLabel(comment)}</strong>
              <small>{current ? comment.body : "Diff 已变化；发送前需要删除或重新批注。"}</small>
            </span>
            <button
              aria-label={`移除 ${comment.file.relativePath} 的修改意见`}
              disabled={disabled}
              onClick={() => useTaskDraftStore.getState().removeReviewComments(taskId, [comment.id])}
              title="移除修改意见"
              type="button"
            ><X aria-hidden="true" size={12} /></button>
          </div>
        );
      })}
    </div>
  );
}

function anchorLabel(comment: ComposerReviewComment): string {
  const side = comment.anchor.side === "new" ? "新" : "旧";
  const line = comment.anchor.startLine === comment.anchor.endLine
    ? `${comment.anchor.startLine}`
    : `${comment.anchor.startLine}-${comment.anchor.endLine}`;
  return `${side} ${line} 行`;
}

function fileName(relativePath: string): string {
  return relativePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? relativePath;
}
