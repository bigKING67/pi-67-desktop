import type { ToolCallPart, WorkspaceChangeView } from "@pi67/domain";
import { boundToolText, compactToolText } from "./tool-presentation-boundaries.js";

const COPY_TEXT_LIMIT = 4_000;
const TOOL_NAME_LIMIT = 120;

export type ToolPresentationKind = "command" | "read" | "change" | "delegated" | "generic";

interface ToolPresentationDetail {
  label: string;
  value: string;
}

export interface ToolPresentation {
  presenterId: "extension-adapter" | "bash" | "web-access" | "read-search" | "edit-write" | "generic";
  kind: ToolPresentationKind;
  title: string;
  compact: string;
  details: ToolPresentationDetail[];
  limitations: string[];
  summary?: string;
}

export interface ToolPresenter {
  readonly id: ToolPresentation["presenterId"];
  matches(tool: ToolCallPart): boolean;
  present(tool: ToolCallPart, change?: WorkspaceChangeView): ToolPresentation;
}

export const TOOL_STATUS_LABELS: Readonly<Record<ToolCallPart["status"], string>> = {
  pending: "等待执行",
  running: "执行中",
  completed: "已完成",
  failed: "执行失败",
  interrupted: "已中断",
  cancelled: "已取消",
  lost: "状态丢失",
  unreconciled: "结果未确认"
};

export function createToolCopyText(
  tool: ToolCallPart,
  presentation: ToolPresentation
): string {
  const lines = [
    presentation.title,
    `工具: ${getToolDisplayName(tool.name)}`,
    `状态: ${TOOL_STATUS_LABELS[tool.status]}`,
    ...presentation.details.map((detail) => `${detail.label}: ${detail.value}`),
    ...(presentation.summary ? [`调用摘要:\n${presentation.summary}`] : []),
    ...presentation.limitations.map((limitation) => `说明: ${limitation}`)
  ];
  return boundToolText(lines.join("\n"), COPY_TEXT_LIMIT);
}

export function getToolDisplayName(name: string): string {
  return compactToolText(name, "未知工具", TOOL_NAME_LIMIT);
}
