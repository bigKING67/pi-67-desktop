import { getToolDisplayName, type ToolPresenter } from "../tool-presentation.js";
import {
  compactToolDetails,
  compactToolText,
  normalizeToolSummary
} from "../tool-presentation-boundaries.js";
import { genericToolPresenter } from "./generic-tool-presenter.js";
import { workspaceChangeStatusLabel } from "./workspace-tool-presenters.js";

export const extensionToolPresenter: ToolPresenter = {
  id: "extension-adapter",
  matches: (tool) => tool.adapter !== undefined,
  present(tool, change) {
    const adapter = tool.adapter;
    if (!adapter) return genericToolPresenter.present(tool, change);
    const summary = normalizeToolSummary(tool.summary);
    return {
      presenterId: "extension-adapter",
      kind: adapter.presentation,
      title: adapter.label ?? getToolDisplayName(tool.name),
      compact: compactToolText(change?.path ?? summary, `由 ${adapter.package} 提供`),
      details: compactToolDetails([
        { label: "Extension", value: adapter.package },
        { label: "Adapter", value: adapter.adapterId },
        change ? { label: "记录文件", value: change.path } : undefined,
        change ? { label: "记录状态", value: workspaceChangeStatusLabel(change.status) } : undefined
      ]),
      limitations: [
        "展示类型来自已验证的声明式 Adapter；不会加载 Extension 提供的 HTML、脚本或组件。",
        ...(change === undefined && adapter.presentation === "change"
          ? ["当前 Pi Session 投影没有可验证的文件变更记录。"]
          : []),
        "当前投影未记录完整 Tool Output。"
      ],
      ...(summary ? { summary } : {})
    };
  }
};
