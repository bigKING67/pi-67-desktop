import { getToolDisplayName, type ToolPresenter } from "../tool-presentation.js";
import {
  compactToolText,
  isStructuredToolSummary,
  normalizeToolSummary
} from "../tool-presentation-boundaries.js";

export const genericToolPresenter: ToolPresenter = {
  id: "generic",
  matches: () => true,
  present(tool) {
    const summary = normalizeToolSummary(tool.summary);
    const structured = isStructuredToolSummary(summary);
    return {
      presenterId: "generic",
      kind: "generic",
      title: getToolDisplayName(tool.name),
      compact: compactToolText(
        structured ? undefined : summary,
        summary ? "已提交参数" : "当前投影未提供工具摘要"
      ),
      details: [],
      limitations: ["该工具没有专用呈现器；仅显示工具名称、状态和有界摘要。"],
      ...(summary ? { summary } : {})
    };
  }
};
