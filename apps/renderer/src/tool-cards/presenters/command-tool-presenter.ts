import type { ToolPresenter } from "../tool-presentation.js";
import {
  compactToolDetails,
  compactToolText,
  matchesToolName,
  normalizeToolSummary,
  parseToolSummaryFields,
  readToolSummaryTextField
} from "../tool-presentation-boundaries.js";

export const commandToolPresenter: ToolPresenter = {
  id: "bash",
  matches: (tool) => matchesToolName(
    tool.name,
    ["bash", "shell", "exec", "exec-command", "run-command"]
  ),
  present(tool) {
    const summary = normalizeToolSummary(tool.execution?.inputSummary?.text ?? tool.summary);
    const fields = parseToolSummaryFields(tool.summary);
    const command = tool.execution?.command?.text
      ?? readToolSummaryTextField(fields, ["command", "cmd", "script"]);
    const cwd = tool.execution?.cwd ?? readToolSummaryTextField(
      fields,
      ["cwd", "workingDirectory", "working_directory"]
    );
    const duration = formatDuration(tool.execution?.durationMs);

    return {
      presenterId: "bash",
      kind: "command",
      title: "执行命令",
      compact: compactToolText(command ?? summary, "命令详情未提供"),
      details: compactToolDetails([
        command ? { label: "命令", value: command } : undefined,
        cwd ? { label: "工作目录", value: cwd } : undefined,
        duration ? { label: "耗时", value: duration } : undefined
      ]),
      limitations: [],
      ...(summary ? { summary } : {})
    };
  }
};

function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined) return undefined;
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${Math.round(durationMs / 1_000)} s`;
}
