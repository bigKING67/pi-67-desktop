import type { ToolAuthorizationProjection } from "@pi67/domain";
import { CheckCircle2, ChevronRight, FileSearch } from "lucide-react";
import { messages } from "../localization/message-catalog.js";
import { ToolCard } from "../tool-cards/index.js";
import type { ProcessRenderItem } from "./process-exploration.js";
import styles from "./TranscriptExplorationStep.module.css";

type ExplorationRun = Extract<ProcessRenderItem, { kind: "exploration" }>;

/** One quiet row for a run of successful reads/searches; expanding restores every call in order. */
export function TranscriptExplorationStep({
  run,
  authorizations
}: {
  run: ExplorationRun;
  authorizations: ReadonlyMap<string, ToolAuthorizationProjection>;
}) {
  const summary = messages.transcript.explorationSummary(run.reads, run.searches);
  // AUTO reasons are Runtime-authored evidence, so the collapsed row keeps each distinct one visible.
  const autoReasons = [...new Set(run.items.flatMap((item) => {
    const authorization = item.call.execution?.authorization ?? authorizations.get(item.call.id);
    return authorization ? [messages.operation.autoAuthorizationReasons[authorization.reason]] : [];
  }))];
  return (
    <details className={styles.exploration} data-exploration-count={run.items.length}>
      <summary>
        <FileSearch aria-hidden="true" className={styles.kindIcon} size={15} />
        <span className={styles.identity}>
          <strong>{summary}</strong>
          {autoReasons.length > 0 ? (
            <span className={styles.authorization} data-tool-authorization="auto">{autoReasons.join("，")}</span>
          ) : null}
        </span>
        <CheckCircle2 aria-hidden="true" className={styles.status} size={14} />
        <span className="sr-only">已完成</span>
        <ChevronRight aria-hidden="true" className={styles.chevron} size={14} />
      </summary>
      <ol className={styles.calls}>
        {run.items.map((item) => {
          // ToolCard itself prefers the execution's own authorization over this timeline fallback.
          const fallback = authorizations.get(item.call.id);
          return (
            <li key={item.key}>
              <ToolCard
                {...(fallback === undefined ? {} : { authorization: fallback })}
                {...(item.result === undefined ? {} : { result: item.result })}
                tool={item.call}
              />
            </li>
          );
        })}
      </ol>
    </details>
  );
}
