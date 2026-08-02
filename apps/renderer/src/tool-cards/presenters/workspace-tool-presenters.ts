import type { WorkspaceChangeView } from "@pi67/domain";
import type { ToolPresenter } from "../tool-presentation.js";
import {
  compactToolDetails,
  compactToolText,
  matchesToolName,
  normalizeToolSummary,
  parseToolSummaryFields,
  readToolSummaryTextField
} from "../tool-presentation-boundaries.js";

export const readSearchToolPresenter: ToolPresenter = {
  id: "read-search",
  matches: (tool) => matchesToolName(tool.name, [
    "read",
    "read-file",
    "grep",
    "glob",
    "search",
    "search-files",
    "find-files"
  ]),
  present(tool) {
    const summary = normalizeToolSummary(tool.summary);
    const fields = parseToolSummaryFields(tool.summary);
    const path = readToolSummaryTextField(
      fields,
      ["path", "file", "filePath", "file_path", "directory", "dir"]
    );
    const query = readToolSummaryTextField(
      fields,
      ["pattern", "query", "search", "glob"]
    );
    const mode = readMode(tool.name);
    const compact = [query, path]
      .filter((value): value is string => Boolean(value))
      .join(" · ");

    return {
      presenterId: "read-search",
      kind: "read",
      title: mode === "read" ? "读取文件" : mode === "glob" ? "匹配文件" : "搜索内容",
      compact: compactToolText(
        compact || summary,
        mode === "read" ? "文件路径未提供" : "搜索条件未提供"
      ),
      details: compactToolDetails([
        query ? { label: mode === "glob" ? "匹配模式" : "搜索条件", value: query } : undefined,
        path ? { label: "范围", value: path } : undefined
      ]),
      limitations: ["当前投影未包含读取或搜索结果明细。"],
      ...(summary ? { summary } : {})
    };
  }
};

export const editWriteToolPresenter: ToolPresenter = {
  id: "edit-write",
  matches: (tool) => matchesToolName(tool.name, [
    "edit",
    "edit-file",
    "apply-patch",
    "patch",
    "write",
    "write-file"
  ]),
  present(tool, change) {
    if (change) return presentWorkspaceChange(change);

    const summary = normalizeToolSummary(tool.summary);
    const fields = parseToolSummaryFields(tool.summary);
    const path = readToolSummaryTextField(
      fields,
      ["path", "file", "filePath", "file_path", "target"]
    );
    const isWrite = matchesToolName(tool.name, ["write", "write-file"]);

    return {
      presenterId: "edit-write",
      kind: "change",
      title: isWrite ? "写入文件" : "修改文件",
      compact: compactToolText(path ?? summary, "文件路径未提供"),
      details: compactToolDetails([path ? { label: "文件", value: path } : undefined]),
      limitations: ["当前投影未包含 Diff、增删行统计或文件预览。"],
      ...(summary ? { summary } : {})
    };
  }
};

export function workspaceChangeStatusLabel(
  status: WorkspaceChangeView["status"]
): string {
  return status === "running"
    ? "执行中"
    : status === "completed"
      ? "已完成"
      : status === "failed"
        ? "失败"
        : "未记录结束结果";
}

function presentWorkspaceChange(change: WorkspaceChangeView) {
  const isWrite = change.kind === "write";
  const statistics = change.kind !== "edit"
    || (change.additions === undefined && change.deletions === undefined)
    ? undefined
    : `+${change.additions ?? 0} -${change.deletions ?? 0}`;
  return {
    presenterId: "edit-write" as const,
    kind: "change" as const,
    title: isWrite ? "写入文件" : "修改文件",
    compact: change.path,
    details: compactToolDetails([
      { label: "文件", value: change.path },
      { label: "记录状态", value: workspaceChangeStatusLabel(change.status) },
      statistics ? { label: "变更", value: statistics } : undefined,
      change.kind === "write" && change.writtenBytes !== undefined
        ? { label: "写入大小", value: `${change.writtenBytes} bytes` }
        : undefined
    ]),
    limitations: isWrite
      ? ["Pi 的 write Tool Result 不包含写入前版本，因此不生成历史 Diff。"]
      : change.patch
        ? ["Pi Session 记录包含 Patch；它不等于当前 Git Diff。"]
        : ["Session 中没有可验证的完整 Edit Patch。"]
  };
}

function readMode(name: string): "read" | "search" | "glob" {
  if (matchesToolName(name, ["glob", "find-files"])) return "glob";
  if (matchesToolName(name, ["grep", "search", "search-files"])) return "search";
  return "read";
}
