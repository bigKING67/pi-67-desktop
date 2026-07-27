import type { ToolCallPart } from "@pi67/domain";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  FilePenLine,
  FileSearch,
  LoaderCircle,
  Terminal,
  Wrench
} from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import { useCommittedWorkspaceChange } from "../changes/workspace-changes-store.js";
import { useShellStore } from "../shell/shell-store.js";
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

export function ToolCard({ tool }: { tool: ToolCallPart }) {
  const change = useCommittedWorkspaceChange(tool.id);
  const setContextTab = useShellStore((state) => state.setContextTab);
  const setContextVisible = useShellStore((state) => state.setContextVisible);
  const presentation = presentToolCall(tool, change);
  const KindIcon = KIND_ICONS[presentation.kind];
  const StatusIcon = STATUS_ICONS[tool.status];
  const statusLabel = TOOL_STATUS_LABELS[tool.status];
  const toolName = getToolDisplayName(tool.name);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  async function copyDetails() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(createToolCopyText(tool, presentation));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section
      className={`${styles.card} ${styles[`status-${tool.status}`]}`}
      aria-label={`${presentation.title}，${statusLabel}`}
      data-presenter={presentation.presenterId}
      data-tool-status={tool.status}
    >
      <div className={styles.header}>
        <span className={styles.kindIcon} aria-hidden="true"><KindIcon size={15} /></span>
        <div className={styles.identity}>
          <span className={styles.titleRow}>
            <strong>{presentation.title}</strong>
            <code>{toolName}</code>
          </span>
          <span className={styles.compact}>{presentation.compact}</span>
        </div>
        <span className={styles.status}>
          <StatusIcon className={tool.status === "running" ? styles.spinning : undefined} size={14} aria-hidden="true" />
          {statusLabel}
        </span>
      </div>

      <details className={styles.details}>
        <summary>查看详情</summary>
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
              <span>有界调用摘要</span>
              <pre>{presentation.summary}</pre>
            </div>
          ) : tool.status === "failed" ? (
            <p className={styles.failureDetail}>工具报告执行失败，但当前投影没有失败详情。</p>
          ) : null}

          <ul className={styles.limitations} aria-label="当前可用信息说明">
            {presentation.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>

          <div className={styles.actions}>
            {change ? (
              <Button className={styles.copyButton!} onPress={() => {
                setContextTab("changes");
                setContextVisible(true);
              }}>
                <FilePenLine size={13} aria-hidden="true" />
                查看修改记录
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
      </details>
    </section>
  );
}
