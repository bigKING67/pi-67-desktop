import type { PlanProposalTimelineView } from "@pi67/domain";
import { lazy, Suspense } from "react";
import styles from "./Transcript.module.css";

const PlanProposalCard = lazy(() => import("./PlanProposalCard.js").then((module) => ({
  default: module.PlanProposalCard
})));

export function DeferredPlanProposalCard({ plan }: { plan: PlanProposalTimelineView }) {
  return (
    <Suspense fallback={(
      <div aria-busy="true" className={styles.loading} role="status">
        <span className="loading-line" />正在加载计划
      </div>
    )}>
      <PlanProposalCard plan={plan} />
    </Suspense>
  );
}
