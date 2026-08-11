import type {
  SessionMessageView,
  ToolAuthorizationProjection,
  ToolCallPart
} from "@pi67/domain";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  FilePenLine,
  FileSearch,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Network,
  Square,
  Terminal,
  Wrench
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useCommittedWorkspaceChange } from "../changes/workspace-changes-store.js";
import { useCopyFeedback } from "../clipboard/use-copy-feedback.js";
import { messages } from "../localization/message-catalog.js";
import { AssetImage } from "../transcript/AssetImage.js";
import { messageTextForCopy } from "../transcript/message-actions.js";
import styles from "./ToolCard.module.css";
import { boundToolText } from "./tool-presentation-boundaries.js";
import {
  createToolCopyText,
  getToolDisplayName,
  presentToolCall,
  TOOL_STATUS_LABELS,
  type ToolPresentationKind
} from "./tool-presenters.js";

const KIND_ICONS = {
  command: Terminal,
  read: FileSearch,
  change: FilePenLine,
  delegated: Network,
  generic: Wrench
} satisfies Record<ToolPresentationKind, typeof Wrench>;

const STATUS_ICONS = {
  pending: Clock3,
  running: LoaderCircle,
  completed: CheckCircle2,
  failed: AlertCircle,
  interrupted: CircleAlert,
  cancelled: Square,
  lost: CircleAlert,
  unreconciled: CircleAlert
} satisfies Record<ToolCallPart["status"], typeof Wrench>;

export function ToolCard({
  tool,
  result,
  authorization
}: {
  tool: ToolCallPart;
  result?: SessionMessageView;
  authorization?: ToolAuthorizationProjection;
}) {
  const change = useCommittedWorkspaceChange(tool.id);
  const execution = tool.execution;
  const projectedTool: ToolCallPart = execution?.inputSummary === undefined
    ? tool
    : { ...tool, summary: execution.inputSummary.text };
  const presentation = presentToolCall(projectedTool, change);
  const KindIcon = KIND_ICONS[presentation.kind];
  const projectedStatus = execution?.status ?? tool.status;
  const failed = projectedStatus === "failed" || Boolean(result?.error);
  const effectiveStatus = failed ? "failed" : projectedStatus;
  const StatusIcon = STATUS_ICONS[effectiveStatus];
  const statusLabel = TOOL_STATUS_LABELS[effectiveStatus];
  const toolName = getToolDisplayName(tool.name);
  const effectiveAuthorization = execution?.authorization ?? authorization;
  const { copyState, copyText } = useCopyFeedback({ failureTitle: "工具详情复制失败" });
  const unsuccessful = effectiveStatus === "failed"
    || effectiveStatus === "interrupted"
    || effectiveStatus === "cancelled"
    || effectiveStatus === "lost"
    || effectiveStatus === "unreconciled";
  const [open, setOpen] = useState(unsuccessful);
  const [expanded, setExpanded] = useState(false);
  const previousUnsuccessful = useRef(unsuccessful);
  const resultText = result === undefined ? undefined : messageTextForCopy(result);
  const hasLongResult = (resultText?.length ?? 0) > 800;
  const failureMessage = toolFailureMessage(execution?.failure?.message?.text, result?.error, resultText);

  useEffect(() => {
    if (!previousUnsuccessful.current && unsuccessful) setOpen(true);
    previousUnsuccessful.current = unsuccessful;
  }, [unsuccessful]);

  async function copyDetails() {
    const callText = createToolCopyText({ ...projectedTool, status: effectiveStatus }, presentation);
    const projectedDetails = [
      execution?.progress ? `实时输出\n${execution.progress.text}` : undefined,
      failureMessage ? `失败详情\n${failureMessage}` : undefined
    ].filter((value): value is string => value !== undefined);
    await copyText(boundToolText([callText, ...projectedDetails].join("\n\n"), 8_000));
  }

  return (
    <details
      className={`${styles.card} ${styles[`status-${effectiveStatus}`]}`}
      aria-label={`${presentation.title}，${statusLabel}${effectiveAuthorization ? `，${authorizationLabel(effectiveAuthorization)}` : ""}`}
      data-presenter={presentation.presenterId}
      data-tool-status={effectiveStatus}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (!nextOpen) setExpanded(false);
      }}
    >
      <summary className={styles.header}>
        <span className={styles.kindIcon} aria-hidden="true"><KindIcon size={15} /></span>
        <div className={styles.identity}>
          <span className={styles.titleRow}>
            <strong>{presentation.title}</strong>
          </span>
          <span className={styles.compact}>{presentation.compact}</span>
          {effectiveAuthorization ? (
            <span
              className={styles.authorization}
              data-tool-authorization="auto"
              data-tool-authorization-reason={effectiveAuthorization.reason}
            >
              {authorizationLabel(effectiveAuthorization)}
            </span>
          ) : null}
        </div>
        <span className={styles.status}>
          <StatusIcon className={effectiveStatus === "running" ? styles.spinning : undefined} size={14} aria-hidden="true" />
          {statusLabel}
        </span>
        <ChevronRight aria-hidden="true" className={styles.chevron} size={14} />
      </summary>

      {open ? (
        <div className={styles.detailBody}>
          <dl className={styles.detailList}>
            <div>
              <dt>精确工具</dt>
              <dd><code>{toolName}</code></dd>
            </div>
            {presentation.details.map((detail, index) => (
              <div key={`${detail.label}:${index}`}>
                <dt>{detail.label}</dt>
                <dd><code>{detail.value}</code></dd>
              </div>
            ))}
          </dl>

          {presentation.summary ? (
            <div className={styles.rawSummary}>
              <span>调用参数</span>
              <pre>{presentation.summary}</pre>
            </div>
          ) : null}

          {execution?.progress ? (
            <div className={styles.progress}>
              <span>实时输出</span>
              <pre>{execution.progress.text}{execution.progress.truncated ? "\n…仅显示最近片段" : ""}</pre>
            </div>
          ) : null}

          {effectiveStatus === "failed" ? (
            <p className={styles.failureDetail}>
              {failureMessage ?? "该步骤失败，但 Pi 结果中没有可显示的错误详情。"}
            </p>
          ) : effectiveStatus === "unreconciled" ? (
            <p className={styles.warningDetail}>该步骤未找到可核对的 Tool Result，结果未能确认。</p>
          ) : effectiveStatus === "interrupted" ? (
            <p className={styles.warningDetail}>该步骤在执行完成前被中断，结果未能确认。</p>
          ) : effectiveStatus === "lost" ? (
            <p className={styles.warningDetail}>该步骤的运行状态已丢失，结果未能确认。</p>
          ) : effectiveStatus === "cancelled" ? (
            <p className={styles.emptyResult}>该步骤已取消。</p>
          ) : null}

          {result ? (
            <div className={styles.result}>
              <span>工具结果</span>
              {resultText ? (
                <pre className={expanded ? styles.resultExpanded : undefined}>{resultText}</pre>
              ) : result.error ? (
                <p className={styles.failureDetail}>{result.error}</p>
              ) : (
                <p className={styles.emptyResult}>工具没有返回可显示的文本内容。</p>
              )}
              {result.parts.map((part, index) => part.type === "image" ? (
                <AssetImage
                  asset={part.asset}
                  key={`${result.id}-tool-image-${index}`}
                  mimeType={part.mimeType}
                  name={part.name}
                />
              ) : null)}
            </div>
          ) : effectiveStatus === "running" || effectiveStatus === "pending" ? (
            <p className={styles.pendingResult}>等待工具返回结果。</p>
          ) : (
            <p className={styles.emptyResult}>当前会话记录中尚未找到对应的工具结果。</p>
          )}

          {presentation.limitations.length > 0 ? (
            <ul className={styles.limitations} aria-label="当前可用信息说明">
              {presentation.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          ) : null}

          <div className={styles.actions}>
            {hasLongResult ? (
              <Button className={styles.copyButton!} onPress={() => setExpanded((value) => !value)}>
                {expanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
                {expanded ? "收起结果" : "展开全部"}
              </Button>
            ) : null}
            <Button
              aria-live="polite"
              className={`${styles.copyButton!} ${copyState === "failed" ? styles.copyError! : ""}`}
              onPress={() => void copyDetails()}
            >
              {copyState === "copied"
                ? <CheckCircle2 size={13} aria-hidden="true" />
                : copyState === "failed"
                  ? <AlertCircle size={13} aria-hidden="true" />
                  : <Copy size={13} aria-hidden="true" />}
              {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制详情"}
            </Button>
          </div>
        </div>
      ) : null}
    </details>
  );
}

function authorizationLabel(authorization: ToolAuthorizationProjection): string {
  return messages.operation.autoAuthorizationReasons[authorization.reason];
}

function toolFailureMessage(
  projected: string | undefined,
  resultError: string | undefined,
  resultText: string | undefined
): string | undefined {
  if (projected?.trim()) return projected;
  if (resultError?.trim() && resultError !== "Tool execution failed.") {
    return boundToolText(resultError, 4_096);
  }
  return resultText?.trim() ? boundToolText(resultText, 4_096) : undefined;
}
