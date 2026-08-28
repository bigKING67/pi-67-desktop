import { Check, Clipboard, ListTodo, PencilLine, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { useCopyFeedback } from "../clipboard/use-copy-feedback.js";
import { isActiveOperationLifecycle } from "../operation/operation-lifecycle.js";
import { implementRendererPlan } from "../session/session-plan-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectActiveProposedPlan,
  selectPlanLifecycle
} from "../session/session-projection-selectors.js";
import styles from "./PlanProposalCard.module.css";

interface ActivePlanActionBarProps {
  hasDraft: boolean;
  refineBusy: boolean;
  onRefine: () => void;
}

export function ActivePlanActionBar({
  hasDraft,
  refineBusy,
  onRefine
}: ActivePlanActionBarProps) {
  const plan = useSessionProjectionStore(selectActiveProposedPlan);
  const planLifecycle = useSessionProjectionStore(selectPlanLifecycle);
  const operation = useAppStore((state) => state.operation);
  const operationDetail = useAppStore((state) => state.operationDetail);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const [requestingImplementation, setRequestingImplementation] = useState(false);
  const { copyState, copyText } = useCopyFeedback({ failureTitle: "计划复制失败" });
  const operationActive = Boolean(operation && isActiveOperationLifecycle(operation.lifecycle));

  useEffect(() => {
    setRequestingImplementation(false);
  }, [plan?.planId]);

  if (!plan) return null;

  const implementationPending = requestingImplementation || (
    planLifecycle?.planId === plan.planId
    && planLifecycle.phase === "implementation-requested"
  );
  const disabled = implementationPending || refineBusy || operationActive || sessionTransitionPending;
  const error = planLifecycle?.planId === plan.planId
    && planLifecycle.phase === "implementation-start-failed"
    && operation?.operationId === planLifecycle.operationId
    && operation.lifecycle === "failed"
      ? operationDetail
      : undefined;
  const implement = async () => {
    if (disabled) return;
    setRequestingImplementation(true);
    try {
      await implementRendererPlan(plan.planId, crypto.randomUUID());
    } finally {
      setRequestingImplementation(false);
    }
  };

  return (
    <aside className={styles.actionRegion} data-testid="active-plan-action-bar">
      <div className={styles.actionBar}>
        <span className={styles.actionLabel}>
          <ListTodo aria-hidden="true" size={15} />
          <span>
            <strong>{implementationPending ? "正在启动计划" : "计划待确认"}</strong>
            <small>{hasDraft ? "发送当前内容以继续完善" : "从 Timeline 查看完整内容"}</small>
          </span>
        </span>
        <div className={styles.compactActions}>
          <button
            aria-label={copyState === "copied" ? "计划已复制" : "复制计划"}
            onClick={() => void copyText(plan.markdown)}
            type="button"
          >
            {copyState === "copied"
              ? <Check aria-hidden="true" size={14} />
              : <Clipboard aria-hidden="true" size={14} />}
            {copyState === "copied" ? "已复制" : "复制"}
          </button>
          {implementationPending ? (
            <button className={styles.implementButton} disabled type="button">
              <Play aria-hidden="true" size={14} />正在启动
            </button>
          ) : hasDraft ? (
            <button disabled={disabled} onClick={onRefine} type="button">
              <PencilLine aria-hidden="true" size={14} />{refineBusy ? "正在发送" : "继续完善"}
            </button>
          ) : (
            <button
              className={styles.implementButton}
              disabled={disabled}
              onClick={() => void implement()}
              type="button"
            ><Play aria-hidden="true" size={14} />开始执行</button>
          )}
        </div>
      </div>
      {error ? <div className={styles.actionError} role="alert">{error}</div> : null}
    </aside>
  );
}
