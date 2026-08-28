import type { PlanLifecycleChange, PlanProposalTimelineView } from "@pi67/domain";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  ListTodo,
  XCircle
} from "lucide-react";
import { useEffect, useState } from "react";
import { useCopyFeedback } from "../clipboard/use-copy-feedback.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectPlanLifecycle } from "../session/session-projection-selectors.js";
import { MarkdownView } from "./MarkdownView.js";
import styles from "./PlanProposalCard.module.css";

export function PlanProposalCard({ plan }: { plan: PlanProposalTimelineView }) {
  const [expanded, setExpanded] = useState(true);
  const { copyState, copyText } = useCopyFeedback({ failureTitle: "计划复制失败" });
  const planLifecycle = useSessionProjectionStore(selectPlanLifecycle);
  const effectiveStatus = effectivePlanStatus(plan, planLifecycle);
  const status = planStatusPresentation(effectiveStatus);
  const StatusIcon = status.icon;

  useEffect(() => setExpanded(true), [plan.entryId]);

  return (
    <article
      aria-label={`Pi 计划提案，${status.label}`}
      className={styles.timelineCard}
      data-plan-id={plan.planId}
      data-plan-status={effectiveStatus}
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
            <small className={styles.status} data-status={effectiveStatus}>
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

function effectivePlanStatus(
  plan: PlanProposalTimelineView,
  lifecycle: PlanLifecycleChange | undefined
): PlanProposalTimelineView["status"] {
  if (lifecycle?.planId !== plan.planId) return plan.status;
  if (lifecycle.phase === "implementation-started") return "implemented";
  if (lifecycle.phase === "dismissed") return "dismissed";
  return plan.status;
}

function planStatusPresentation(status: PlanProposalTimelineView["status"]): {
  label: string;
  icon: typeof CheckCircle2;
} {
  if (status === "implemented") return { label: "已开始执行", icon: CheckCircle2 };
  if (status === "dismissed") return { label: "已结束", icon: XCircle };
  return { label: "待确认", icon: ListTodo };
}
