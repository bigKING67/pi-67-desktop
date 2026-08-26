import { useEffect } from "react";
import { Check, FolderRoot, GitBranch } from "lucide-react";
import type { WorkspaceDescriptor } from "@pi67/domain";
import { Composer } from "../composer/Composer.js";
import { messages } from "../localization/message-catalog.js";
import { TrustBanner } from "../workspace/TrustBanner.js";
import type { RendererWorkbenchTask } from "../workbench/workbench-store.js";
import { inspectRepositoryEnvironment } from "../worktree/repository-environment-controller.js";
import { useRepositoryEnvironmentStore } from "../worktree/repository-environment-store.js";
import {
  cancelWorktreeSessionEnvironment
} from "../worktree/worktree-session-environment-controller.js";
import {
  selectRendererTaskEnvironmentIntent,
  worktreeIntentAvailability
} from "../worktree/worktree-environment-intent-controller.js";
import styles from "./WorkspaceShell.module.css";

export function NewSessionIntentSurface({ task, workspace }: {
  task: RendererWorkbenchTask;
  workspace: WorkspaceDescriptor;
}) {
  const record = useRepositoryEnvironmentStore((state) => state.records[workspace.id]);
  const availability = worktreeIntentAvailability(task, workspace, record);
  const intent = task.environmentIntent ?? "local";
  const copy = messages.runtime.worktreeCreation;
  const environmentHelpId = `environment-help-${task.id}`;

  useEffect(() => {
    if (!record || record.status === "idle") void inspectRepositoryEnvironment(workspace.id);
  }, [record, workspace.id]);

  return (
    <section aria-label="准备新对话" className="conversation-region" data-testid="new-session-intent">
      <TrustBanner />
      <div className={styles.newSessionIntent}>
        <span className="section-label">{workspace.displayName}</span>
        <h2>准备新对话</h2>
        <p>先写下第一条消息。只有点击发送后才会创建 Pi JSONL 会话；创建或发送失败时，草稿会继续保留。</p>
        <fieldset
          aria-describedby={environmentHelpId}
          className={styles.environmentSelector}
          data-testid="new-session-environment-selector"
        >
          <legend>{copy.environmentHeading}</legend>
          <div className={styles.environmentOptions}>
            <label className={styles.environmentOption} data-selected={intent === "local"}>
              <input
                checked={intent === "local"}
                disabled={availability.status === "locked"}
                name={`environment-${task.id}`}
                onChange={() => void selectRendererTaskEnvironmentIntent(task.id, "local")}
                type="radio"
                value="local"
              />
              <FolderRoot aria-hidden="true" size={18} />
              <span>
                <strong>{copy.localLabel}</strong>
                <small>{copy.localDescription}</small>
              </span>
              {intent === "local" ? <Check aria-hidden="true" size={16} /> : null}
            </label>
            <label
              className={styles.environmentOption}
              data-disabled={availability.status !== "available"}
              data-selected={intent === "worktree"}
            >
              <input
                checked={intent === "worktree"}
                disabled={availability.status !== "available"}
                name={`environment-${task.id}`}
                onChange={() => void selectRendererTaskEnvironmentIntent(task.id, "worktree")}
                type="radio"
                value="worktree"
              />
              <GitBranch aria-hidden="true" size={18} />
              <span>
                <strong>{copy.worktreeLabel}</strong>
                <small>{copy.worktreeDescription}</small>
              </span>
              {intent === "worktree" ? <Check aria-hidden="true" size={16} /> : null}
            </label>
          </div>
          <div className={styles.environmentHelp}>
            <p aria-live="polite" id={environmentHelpId}>{availability.status === "available"
              ? copy.noSideEffect
              : copy.availability[availability.code]}</p>
            {task.environmentCreationState === "creating" ? (
              <p aria-live="polite">{task.runtime.detail}</p>
            ) : null}
            {availability.retryable ? (
              <button
                className={styles.environmentRetry}
                onClick={() => void inspectRepositoryEnvironment(workspace.id)}
                type="button"
              >{copy.retryInspection}</button>
            ) : null}
            {task.environmentCreationState === "creating" && task.environmentCreationId ? (
              <button
                className={styles.environmentRetry}
                onClick={() => void cancelWorktreeSessionEnvironment(task.id)}
                type="button"
              >{copy.cancel}</button>
            ) : null}
          </div>
        </fieldset>
        {task.hasDraft ? <small>草稿会使用系统安全存储跨应用重启恢复。</small> : null}
      </div>
      <Composer />
    </section>
  );
}
