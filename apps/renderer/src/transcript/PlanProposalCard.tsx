import type { PlanProposalTimelineView } from "@pi67/domain";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  ListTodo,
  PencilLine,
  Play,
  XCircle
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { useCopyFeedback } from "../clipboard/use-copy-feedback.js";
import { requestComposerPrefill } from "../composer/composer-events.js";
import { isActiveOperationLifecycle } from "../operation/operation-lifecycle.js";
import { implementRendererPlan } from "../session/session-plan-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectActiveProposedPlan } from "../session/session-projection-selectors.js";
import { MarkdownView } from "./MarkdownView.js";
import styles from "./PlanProposalCard.module.css";

const REFINEMENT_PROMPT = "请继续完善当前计划，重点补充遗漏、风险、验证步骤和实施顺序。";

export function PlanProposalCard({ plan }: { plan: PlanProposalTimelineView }) {
  const [expanded, setExpanded] = useState(true);
  const { copyState, copyText } = useCopyFeedback({ failureTitle: "计划复制失败" });
  const status = planStatusPresentation(plan.status);
  const StatusIcon = status.icon;

  useEffect(() => setExpanded(true), [plan.entryId]);

  return (
    <article
      aria-label={`Pi 计划提案，${status.label}`}
      className={styles.timelineCard}
      data-plan-id={plan.planId}
      data-plan-status={plan.status}
      data-testid="plan-proposal-card"
    >
      <header className={styles.header}>
        <button
          aria-expanded={expanded}
          className={styles.disclosure}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <span className={styles.icon}><ListTodo aria-hidden="true" size={16} /></span>
          <span className={styles.heading}>
            <strong>实施计划</strong>
            <small className={styles.status} data-status={plan.status}>
              <StatusIcon aria-hidden="true" size={13} />{status.label}
            </small>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={expanded ? styles.chevronExpanded : undefined}
            size={16}
          />
        </button>
        <button
          aria-label={copyState === "copied" ? "计划已复制" : "复制计划"}
          className={styles.copyButton}
          onClick={() => void copyText(plan.markdown)}
          type="button"
        >
          {copyState === "copied"
            ? <Check aria-hidden="true" size={14} />
            : <Clipboard aria-hidden="true" size={14} />}
          {copyState === "copied" ? "已复制" : "复制"}
        </button>
      </header>
      {expanded ? (
        <div className={styles.body}>
          <MarkdownView>{plan.markdown}</MarkdownView>
        </div>
      ) : null}
    </article>
  );
}

export function ActivePlanActionBar() {
  const plan = useSessionProjectionStore(selectActiveProposedPlan);
  const operation = useAppStore((state) => state.operation);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const [implementing, setImplementing] = useState(false);
  const [error, setError] = useState<string>();
  const { copyState, copyText } = useCopyFeedback({ failureTitle: "计划复制失败" });
  const operationActive = Boolean(operation && isActiveOperationLifecycle(operation.lifecycle));

  useEffect(() => {
    setImplementing(false);
    setError(undefined);
  }, [plan?.planId]);

  if (!plan) return null;

  const disabled = implementing || operationActive || sessionTransitionPending;
  const implement = async () => {
    if (disabled) return;
    setImplementing(true);
    setError(undefined);
    try {
      const result = await implementRendererPlan(plan.planId, crypto.randomUUID());
      if (!result.accepted) setError(result.error);
    } finally {
      setImplementing(false);
    }
  };

  return (
    <aside className={styles.actionRegion} data-testid="active-plan-action-bar">
      <div className={styles.actionBar}>
        <span className={styles.actionLabel}>
          <ListTodo aria-hidden="true" size={15} />
          <span><strong>计划待确认</strong><small>从 Timeline 查看完整内容</small></span>
        </span>
        <div className={styles.compactActions}>
          <button
            aria-label={copyState === "copied" ? "计划已复制" : "复制计划"}
            disabled={implementing}
            onClick={() => void copyText(plan.markdown)}
            type="button"
          >
            {copyState === "copied"
              ? <Check aria-hidden="true" size={14} />
              : <Clipboard aria-hidden="true" size={14} />}
            {copyState === "copied" ? "已复制" : "复制"}
          </button>
          <button
            disabled={disabled}
            onClick={() => requestComposerPrefill(REFINEMENT_PROMPT)}
            type="button"
          ><PencilLine aria-hidden="true" size={14} />继续完善</button>
          <button
            className={styles.implementButton}
            disabled={disabled}
            onClick={() => void implement()}
            type="button"
          ><Play aria-hidden="true" size={14} />{implementing ? "正在开始" : "开始执行"}</button>
        </div>
      </div>
      {error ? <div className={styles.actionError} role="alert">{error}</div> : null}
    </aside>
  );
}

function planStatusPresentation(status: PlanProposalTimelineView["status"]): {
  label: string;
  icon: typeof CheckCircle2;
} {
  if (status === "implemented") return { label: "已开始执行", icon: CheckCircle2 };
  if (status === "dismissed") return { label: "已结束", icon: XCircle };
  return { label: "待确认", icon: ListTodo };
}
