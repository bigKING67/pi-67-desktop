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
    const summary = normalizeToolSummary(tool.summary);
    const fields = parseToolSummaryFields(tool.summary);
    const command = readToolSummaryTextField(fields, ["command", "cmd", "script"]);
    const cwd = readToolSummaryTextField(
      fields,
      ["cwd", "workingDirectory", "working_directory"]
    );

    return {
      presenterId: "bash",
      kind: "command",
      title: "执行命令",
      compact: compactToolText(command ?? summary, "命令详情未提供"),
      details: compactToolDetails([
        command ? { label: "命令", value: command } : undefined,
        cwd ? { label: "工作目录", value: cwd } : undefined
      ]),
      limitations: [
        ...(!cwd ? ["当前投影未记录工作目录。"] : []),
        "当前投影未记录执行耗时或实时输出。"
      ],
      ...(summary ? { summary } : {})
    };
  }
};
