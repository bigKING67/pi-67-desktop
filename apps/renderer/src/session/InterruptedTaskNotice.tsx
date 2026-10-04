import { useEffect, useRef, useState } from "react";
import type { SessionRecoveryView } from "@pi67/domain";
import { useAppStore } from "../app/app-store.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import { continueRendererInterruptedTask, inspectRendererInterruptedTask } from "./interrupted-task-controller.js";
import { acceptRendererSessionResponse, currentRendererSessionAuthority } from "./session-authority.js";
import styles from "./InterruptedTaskNotice.module.css";

export function InterruptedTaskNotice() {
  const authority = useSessionProjectionStore(state => state.authority);
  const key = authority.phase === "active"
    ? JSON.stringify([authority.hostEpoch, authority.sessionFileIdentity, authority.sessionGeneration, authority.projectionRevision])
    : "inactive";
  return <InterruptedTaskNoticeContent key={key} />;
}

function InterruptedTaskNoticeContent() {
  const authority = useSessionProjectionStore(state => state.authority);
  const phase = useAppStore(state => state.runtime.phase);
  const [view, setView] = useState<SessionRecoveryView>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setView(undefined);
    setError(undefined);
    if (authority.phase !== "active" || phase !== "ready") return;
    let current = true;
    void inspectRendererInterruptedTask().then(result => {
      if (current) setView(result);
    }).catch(() => {
      if (current) setError("暂时无法检查上次任务是否完成。");
    });
    return () => { current = false; };
  }, [authority, phase, revision]);

  async function resume() {
    if (submitting.current || view?.status !== "available") return;
    const expectedAuthority = currentRendererSessionAuthority(useAppStore.getState());
    if (!expectedAuthority) return;
    const stillCurrent = () => mounted.current && acceptRendererSessionResponse(useAppStore.getState(), expectedAuthority);
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      await continueRendererInterruptedTask(view.anchor, crypto.randomUUID());
      if (stillCurrent()) setView(undefined);
    } catch (cause) {
      if (stillCurrent()) setError(cause instanceof Error ? cause.message : "未能继续当前任务，请重新检查。");
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  if (authority.phase !== "active" || phase !== "ready" || (!error && (!view || view.status === "none"))) return null;
  return <section className={styles.notice} aria-label="中断任务恢复" data-testid="interrupted-task-notice">
    <div className={styles.copy} role="status">
      <strong>{view?.status === "blocked" ? "继续前需要核对任务" : view?.status === "available" ? "上次任务尚未完成" : "任务恢复状态暂不可用"}</strong>
      {view?.status === "blocked" ? <p>{blockedDescription(view)}</p> : view?.status === "available" ? <p>已保留会话和已确认的结果。继续会调用当前模型；Auto 沿用上次的选择。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
    <div className={styles.actions}>
      {view?.status === "available" && !error ? <button className="primary-button" disabled={pending} onClick={() => void resume()} type="button">
        {pending ? "正在接续…" : "继续当前任务"}
      </button> : null}
      <button className="secondary-button" disabled={pending} onClick={() => setRevision(value => value + 1)} type="button">重新检查</button>
    </div>
  </section>;
}

function blockedDescription(view: Extract<SessionRecoveryView, { status: "blocked" }>): string {
  if (view.reason === "unconfirmed-tools") return `有 ${view.pendingToolCount} 个工具调用没有结果记录，暂时无法直接继续。请先核对实际执行结果，再在输入区说明下一步。`;
  if (view.reason === "auto-selection-missing") return "中断前尚未保存本任务的 Auto 选型。请在输入区明确发送任务，重新判断模型。";
  return "无法从近期记录确认待续任务。请查看会话记录，再在输入区说明下一步。";
}
