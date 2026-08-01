import type {
  OperationKind,
  OperationView,
  ToolAuthorizationProjection,
  ToolCallPart
} from "@pi67/domain";
import { Check, ChevronRight, CircleX, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OperationActivityTimeline,
  OperationTimelineStep
} from "../operation/operation-activity-timeline-store.js";
import { operationPresentation } from "../operation/TurnActivity.js";
import { ToolCard } from "../tool-cards/index.js";
import { AssetImage } from "./AssetImage.js";
import { MarkdownView } from "./MarkdownView.js";
import type { TranscriptProcessItem, TranscriptRow } from "./transcript-rows.js";
import styles from "./TranscriptProcessGroup.module.css";

type ProcessGroupRow = Extract<TranscriptRow, { kind: "process-group" }>;

export function TranscriptProcessGroup({
  row,
  running = false,
  interrupted = false,
  completed = true,
  operation,
  timeline,
  liveThinking = ""
}: {
  row: ProcessGroupRow;
  running?: boolean;
  interrupted?: boolean;
  completed?: boolean;
  operation?: OperationView;
  timeline?: OperationActivityTimeline;
  liveThinking?: string;
}) {
  const failed = row.failed || interrupted;
  const completionReady = completed && row.hasFinalAnswer;
  const [open, setOpen] = useState(running || interrupted || (completed && !row.hasFinalAnswer));
  const previousRunning = useRef(running);
  const previousInterrupted = useRef(interrupted);
  const previousCompletionReady = useRef(completionReady);
  const supplementalThinking = uncommittedLiveThinking(row.items, liveThinking);
  const supplementalTimeline = useMemo(
    () => projectSupplementalTimeline(row.items, timeline, Boolean(liveThinking)),
    [liveThinking, row.items, timeline]
  );
  const toolAuthorizations = useMemo(() => projectToolAuthorizations(timeline), [timeline]);
  const stepCount = Math.max(
    1,
    row.items.length + supplementalTimeline.length + (supplementalThinking ? 1 : 0)
  );

  useEffect(() => {
    if (!previousRunning.current && running) setOpen(true);
    if (!previousInterrupted.current && interrupted) setOpen(true);
    if (!previousCompletionReady.current && completionReady) setOpen(false);
    previousRunning.current = running;
    previousInterrupted.current = interrupted;
    previousCompletionReady.current = completionReady;
  }, [completionReady, interrupted, running]);

  const label = running && operation
    ? operationPresentation(
      operation.kind,
      operation.lifecycle,
      operation.activity,
      undefined,
      undefined
    ).label
    : running
      ? "正在执行"
      : failed
        ? "执行过程有失败"
        : "执行过程";
  const duration = !running && timeline
    ? formatTimelineDuration(timeline.startedAt, timeline.settledAt)
    : undefined;
  const statusDetail = currentBlockingDetail(operation);
  const hasBody = row.items.length > 0 || supplementalThinking !== "" || supplementalTimeline.length > 0 || statusDetail;

  return (
    <details
      className={`${styles.group} ${failed ? styles.failed : ""}`}
      data-operation-lifecycle={operation?.lifecycle}
      data-process-failed={failed ? "true" : "false"}
      data-process-running={running ? "true" : "false"}
      data-testid="transcript-process-group"
      data-turn-activity={operation ? "true" : undefined}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className={styles.statusIcon} aria-hidden="true">
          {running && !row.failed
            ? <LoaderCircle className={styles.spinning} size={14} />
            : failed ? <CircleX size={14} /> : <Check size={14} />}
        </span>
        <span className={styles.summaryCopy} aria-live={running ? "polite" : undefined}>
          <strong>{label}</strong>
          <small>
            {!running ? " · " : ""}{stepCount} 个步骤{duration ? ` · ${duration}` : ""}
          </small>
        </span>
        <ChevronRight className={styles.chevron} size={14} aria-hidden="true" />
      </summary>
      {hasBody ? (
        <ol className={styles.steps} aria-label="模型执行步骤">
          {row.items.map((item) => (
            <ProcessItem
              {...(item.kind === "tool" && toolAuthorizations.has(item.call.id)
                ? { authorization: toolAuthorizations.get(item.call.id)! }
                : {})}
              item={item}
              key={item.key}
            />
          ))}
          {supplementalThinking ? (
            <li className={styles.step} data-process-step="reasoning">
              <Reasoning text={supplementalThinking} streaming />
            </li>
          ) : null}
          {supplementalTimeline.map((item) => item.kind === "tool" ? (
            <li className={styles.step} data-process-step="tool" key={item.key}>
              <ToolCard
                {...(item.authorization === undefined ? {} : { authorization: item.authorization })}
                tool={item.tool}
              />
            </li>
          ) : (
            <li
              className={styles.step}
              data-process-step="timeline-status"
              data-step-status={item.status}
              key={item.key}
            >
              <div className={styles.timelineStatus}>
                <strong>{item.label}</strong>
                {item.detail ? <small>{item.detail}</small> : null}
              </div>
            </li>
          ))}
          {statusDetail ? (
            <li className={styles.step} data-process-step="status">
              <div className={styles.statusNotice}>{statusDetail}</div>
            </li>
          ) : null}
        </ol>
      ) : null}
    </details>
  );
}

function ProcessItem({
  item,
  authorization
}: {
  item: TranscriptProcessItem;
  authorization?: ToolAuthorizationProjection;
}) {
  if (item.kind === "reasoning") {
    return (
      <li className={styles.step} data-process-step="reasoning">
        <Reasoning text={item.text} />
      </li>
    );
  }
  if (item.kind === "narration") {
    return (
      <li className={styles.step} data-process-step="narration">
        <div className={styles.narration}>
          {typeof item.content === "string" ? (
            <MarkdownView mode="settled">{item.content}</MarkdownView>
          ) : (
            <AssetImage
              asset={item.content.asset}
              mimeType={item.content.mimeType}
              name={item.content.name}
            />
          )}
        </div>
      </li>
    );
  }
  if (item.kind === "tool") {
    return (
      <li className={styles.step} data-process-step="tool">
        <ToolCard
          {...(authorization === undefined ? {} : { authorization })}
          {...(item.result === undefined ? {} : { result: item.result })}
          tool={item.call}
        />
      </li>
    );
  }
  const fallbackCall: ToolCallPart = {
    type: "tool-call",
    id: item.result.id,
    name: item.result.toolName ?? "tool",
    status: item.result.error ? "failed" : "completed"
  };
  return (
    <li className={styles.step} data-process-step="orphan-tool-result">
      <ToolCard result={item.result} tool={fallbackCall} />
    </li>
  );
}

function Reasoning({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className={styles.reasoning} aria-label="模型推理">
      <span>分析</span>
      <MarkdownView mode={streaming ? "streaming" : "settled"}>{text}</MarkdownView>
    </div>
  );
}

function uncommittedLiveThinking(items: readonly TranscriptProcessItem[], liveThinking: string): string {
  if (!liveThinking) return "";
  const committed = items
    .filter((item): item is Extract<TranscriptProcessItem, { kind: "reasoning" }> => item.kind === "reasoning")
    .map((item) => item.text)
    .join("");
  if (!committed) return liveThinking;
  if (liveThinking === committed) return "";
  return liveThinking.startsWith(committed) ? liveThinking.slice(committed.length) : liveThinking;
}

type SupplementalTimelineItem =
  | {
    kind: "tool";
    key: string;
    tool: ToolCallPart;
    authorization?: ToolAuthorizationProjection;
  }
  | {
    kind: "status";
    key: string;
    label: string;
    detail?: string;
    status: OperationTimelineStep["status"];
  };

function projectSupplementalTimeline(
  items: readonly TranscriptProcessItem[],
  timeline: OperationActivityTimeline | undefined,
  hasLiveThinking: boolean
): SupplementalTimelineItem[] {
  if (!timeline) return [];
  const committedIds = new Set(items.flatMap((item) => item.kind === "tool" ? [item.call.id] : []));
  const emittedToolIds = new Set<string>();
  const hasPersistedContent = items.length > 0;
  return timeline.steps.flatMap<SupplementalTimelineItem>((step) => {
    if (step.activity?.kind === "tool") {
      if (committedIds.has(step.activity.toolCallId) || emittedToolIds.has(step.activity.toolCallId)) return [];
      emittedToolIds.add(step.activity.toolCallId);
      return [{
        kind: "tool" as const,
        key: `timeline-tool:${step.activity.toolCallId}`,
        tool: {
          type: "tool-call" as const,
          id: step.activity.toolCallId,
          name: step.activity.toolName,
          status: step.activity.status
        },
        ...(step.activity.authorization === undefined
          ? {}
          : { authorization: step.activity.authorization })
      }];
    }
    if (hasPersistedContent) return [];
    if (step.activity === undefined && hasLiveThinking) return [];
    if (step.activity?.kind === "thinking" && hasLiveThinking) return [];
    return [{
      kind: "status" as const,
      key: `timeline-status:${step.id}`,
      label: timelineStepLabel(timeline.operationKind, step),
      ...(step.detail === undefined ? {} : { detail: step.detail }),
      status: step.status
    }];
  });
}

function projectToolAuthorizations(
  timeline: OperationActivityTimeline | undefined
): ReadonlyMap<string, ToolAuthorizationProjection> {
  const result = new Map<string, ToolAuthorizationProjection>();
  for (const step of timeline?.steps ?? []) {
    if (step.activity?.kind === "tool" && step.activity.authorization) {
      result.set(step.activity.toolCallId, step.activity.authorization);
    }
  }
  return result;
}

function timelineStepLabel(operationKind: OperationKind, step: OperationTimelineStep): string {
  const active = step.status === "running";
  if (step.activity === undefined) {
    if (operationKind === "command") return active ? "正在准备命令" : "准备命令";
    return active ? "正在准备任务" : "准备任务";
  }
  if (step.activity === null) return active ? "正在继续处理" : "继续处理";
  if (active) {
    return operationPresentation(operationKind, "running", step.activity, undefined, undefined).label;
  }
  switch (step.activity.kind) {
    case "thinking": return "分析问题";
    case "responding": return "组织回复";
    case "compaction": return "压缩上下文";
    case "approval": return "等待确认";
    case "extension-input": return "等待扩展输入";
    case "tool": return `调用 ${step.activity.toolName}`;
  }
}

function currentBlockingDetail(operation: OperationView | undefined): string | undefined {
  if (operation?.activity?.kind === "approval") return "等待你确认后继续执行。";
  if (operation?.activity?.kind === "extension-input") return "等待扩展输入后继续执行。";
  return undefined;
}

function formatTimelineDuration(startedAt: number, settledAt: number | undefined): string | undefined {
  if (settledAt === undefined) return undefined;
  const seconds = Math.max(0, Math.round((settledAt - startedAt) / 1_000));
  if (seconds < 1) return "不到 1 秒";
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
