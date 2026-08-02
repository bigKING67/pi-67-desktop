import type {
  SessionMessageView,
  ToolAuthorizationProjection,
  ToolCallPart
} from "@pi67/domain";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  FilePenLine,
  FileSearch,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Terminal,
  Wrench
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useCommittedWorkspaceChange } from "../changes/workspace-changes-store.js";
import { messages } from "../localization/message-catalog.js";
import { AssetImage } from "../transcript/AssetImage.js";
import { messageTextForCopy } from "../transcript/message-actions.js";
import styles from "./ToolCard.module.css";
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
  generic: Wrench
} satisfies Record<ToolPresentationKind, typeof Wrench>;

const STATUS_ICONS = {
  pending: Clock3,
  running: LoaderCircle,
  completed: CheckCircle2,
  failed: AlertCircle
} satisfies Record<ToolCallPart["status"], typeof Wrench>;

type CopyState = "idle" | "copied" | "failed";

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
  const presentation = presentToolCall(tool, change);
  const KindIcon = KIND_ICONS[presentation.kind];
  const failed = tool.status === "failed" || Boolean(result?.error);
  const effectiveStatus = failed ? "failed" : tool.status;
  const StatusIcon = STATUS_ICONS[effectiveStatus];
  const statusLabel = TOOL_STATUS_LABELS[effectiveStatus];
  const toolName = getToolDisplayName(tool.name);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [open, setOpen] = useState(failed);
  const [expanded, setExpanded] = useState(false);
  const previousFailed = useRef(failed);
  const resultText = result === undefined ? undefined : messageTextForCopy(result);
  const hasLongResult = (resultText?.length ?? 0) > 800;

  useEffect(() => {
    if (!previousFailed.current && failed) setOpen(true);
    previousFailed.current = failed;
  }, [failed]);

  async function copyDetails() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      const callText = createToolCopyText(tool, presentation);
      await navigator.clipboard.writeText(resultText ? `${callText}\n\n工具结果\n${resultText}` : callText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <details
      className={`${styles.card} ${styles[`status-${effectiveStatus}`]}`}
      aria-label={`${presentation.title}，${statusLabel}${authorization ? `，${authorizationLabel(authorization)}` : ""}`}
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
            <code>{toolName}</code>
          </span>
          <span className={styles.compact}>{presentation.compact}</span>
          {authorization ? (
            <span
              className={styles.authorization}
              data-tool-authorization="auto"
              data-tool-authorization-reason={authorization.reason}
            >
              {authorizationLabel(authorization)}
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
          {presentation.details.length > 0 ? (
            <dl className={styles.detailList}>
              {presentation.details.map((detail) => (
                <div key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd><code>{detail.value}</code></dd>
                </div>
              ))}
            </dl>
          ) : null}

          {presentation.summary ? (
            <div className={styles.rawSummary}>
              <span>调用参数</span>
              <pre>{presentation.summary}</pre>
            </div>
          ) : tool.status === "failed" ? (
            <p className={styles.failureDetail}>工具报告执行失败，但当前投影没有失败详情。</p>
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

          <ul className={styles.limitations} aria-label="当前可用信息说明">
            {presentation.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>

          <div className={styles.actions}>
            {hasLongResult ? (
              <Button className={styles.copyButton!} onPress={() => setExpanded((value) => !value)}>
                {expanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
                {expanded ? "收起结果" : "展开全部"}
              </Button>
            ) : null}
            <Button className={styles.copyButton!} onPress={() => void copyDetails()}>
              <Copy size={13} aria-hidden="true" />
              复制详情
            </Button>
            <span className={copyState === "failed" ? styles.copyError! : ""} aria-live="polite">
              {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : ""}
            </span>
          </div>
        </div>
      ) : null}
    </details>
  );
}

function authorizationLabel(authorization: ToolAuthorizationProjection): string {
  return messages.operation.autoAuthorizationReasons[authorization.reason];
}
