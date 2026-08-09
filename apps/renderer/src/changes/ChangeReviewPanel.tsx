import type { ChangeReviewAnchor, ChangeReviewAuthority } from "@pi67/domain";
import { Check, MessageSquarePlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import {
  addComposerReviewComment,
  reviewAuthorityEquals
} from "./change-review-controller.js";
import { PatchView, projectPatchLines } from "./PatchView.js";
import styles from "./ChangesPanel.module.css";

export function ChangeReviewPanel({
  authority,
  path,
  patch,
  reviewed,
  sourceTruncated,
  taskId,
  onMarkReviewed
}: {
  authority: ChangeReviewAuthority;
  path: string;
  patch: string;
  reviewed: boolean;
  sourceTruncated: boolean;
  taskId: string | undefined;
  onMarkReviewed: () => void;
}) {
  const rendered = useMemo(() => projectPatchLines(patch), [patch]);
  const [anchor, setAnchor] = useState<ChangeReviewAnchor>();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const authorityKey = JSON.stringify(authority);
  const taskComments = useTaskDraftStore((state) => (
    taskId ? state.drafts[taskId]?.reviewComments : undefined
  ));
  const comments = useMemo(() => (taskComments ?? []).filter((comment) => (
    reviewAuthorityEquals(comment.authority, authority)
  )), [authority, taskComments]);
  const reviewEnabled = Boolean(
    taskId
    && !sourceTruncated
    && rendered.omittedLines === 0
    && rendered.lines.some((line) => line.anchor !== undefined)
  );

  useEffect(() => {
    setAnchor(undefined);
    setBody("");
    setError(undefined);
  }, [authorityKey]);

  const add = async () => {
    if (!taskId || !anchor || adding) return;
    setAdding(true);
    setError(undefined);
    const result = await addComposerReviewComment({ taskId, authority, anchor, path, body });
    setAdding(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setAnchor(undefined);
    setBody("");
  };

  return (
    <div className={styles.reviewPanel}>
      <PatchView
        ariaLabel={authority.source === "session" ? "本会话修改 Patch" : "工作区 Git Diff Patch"}
        onAnchorSelect={(next) => {
          setAnchor(next);
          setError(undefined);
        }}
        patch={patch}
        rendered={rendered}
        reviewEnabled={reviewEnabled}
        {...(anchor ? { selectedAnchor: anchor } : {})}
        sourceTruncated={sourceTruncated}
      />
      <div className={styles.reviewToolbar}>
        <div>
          <strong>{comments.length > 0 ? `${comments.length} 条意见待发送` : "Diff 审阅"}</strong>
          <span>{reviewEnabled ? "选择一行添加意见；Reviewed 需要显式确认。" : "精确批注要求完整、可映射的 Unified Diff。"}</span>
        </div>
        <button
          className={styles.reviewedButton}
          data-reviewed={reviewed ? "true" : "false"}
          disabled={!reviewEnabled || reviewed}
          onClick={onMarkReviewed}
          type="button"
        ><Check aria-hidden="true" size={13} />{reviewed ? "已审阅" : "标记为已审阅"}</button>
      </div>
      {anchor ? (
        <div className={styles.reviewEditor}>
          <label htmlFor="change-review-comment">{anchorLabel(anchor)}</label>
          <textarea
            autoFocus
            id="change-review-comment"
            maxLength={16_384}
            onChange={(event) => {
              setBody(event.target.value);
              setError(undefined);
            }}
            placeholder="说明需要修改什么，以及原因或验收条件。"
            rows={3}
            value={body}
          />
          <div>
            <button disabled={adding || body.trim().length === 0} onClick={() => void add()} type="button">
              <MessageSquarePlus aria-hidden="true" size={13} />{adding ? "正在绑定文件…" : "添加修改意见"}
            </button>
            <button className={styles.reviewCancel} disabled={adding} onClick={() => setAnchor(undefined)} type="button">取消</button>
          </div>
        </div>
      ) : null}
      {comments.length > 0 ? (
        <div aria-label="当前修改的待发送意见" className={styles.pendingReviewList}>
          {comments.map((comment) => (
            <div key={comment.id}>
              <span>{anchorLabel(comment.anchor)}</span>
              <p>{comment.body}</p>
              <button
                aria-label={`删除 ${anchorLabel(comment.anchor)} 的修改意见`}
                onClick={() => taskId && useTaskDraftStore.getState().removeReviewComments(taskId, [comment.id])}
                title="删除修改意见"
                type="button"
              ><Trash2 aria-hidden="true" size={12} /></button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className={styles.reviewError} role="alert">{error}</p> : null}
    </div>
  );
}

function anchorLabel(anchor: ChangeReviewAnchor): string {
  const section = anchor.section === "staged"
    ? "staged"
    : anchor.section === "unstaged" ? "unstaged" : "会话";
  const side = anchor.side === "new" ? "新" : "旧";
  const lines = anchor.startLine === anchor.endLine
    ? `${anchor.startLine}`
    : `${anchor.startLine}-${anchor.endLine}`;
  return `${section} · ${side}第 ${lines} 行`;
}
