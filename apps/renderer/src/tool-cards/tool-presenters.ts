import type { ToolCallPart, WorkspaceChangeView } from "@pi67/domain";
import { commandToolPresenter } from "./presenters/command-tool-presenter.js";
import { extensionToolPresenter } from "./presenters/extension-tool-presenter.js";
import { genericToolPresenter } from "./presenters/generic-tool-presenter.js";
import {
  editWriteToolPresenter,
  readSearchToolPresenter
} from "./presenters/workspace-tool-presenters.js";
import type { ToolPresentation, ToolPresenter } from "./tool-presentation.js";

const TOOL_PRESENTERS: readonly ToolPresenter[] = [
  extensionToolPresenter,
  commandToolPresenter,
  readSearchToolPresenter,
  editWriteToolPresenter,
  genericToolPresenter
];

export function selectToolPresenter(tool: ToolCallPart): ToolPresenter {
  return TOOL_PRESENTERS.find((presenter) => presenter.matches(tool))
    ?? genericToolPresenter;
}

export function presentToolCall(tool: ToolCallPart, change?: WorkspaceChangeView): ToolPresentation {
  return selectToolPresenter(tool).present(tool, change);
}

export {
  createToolCopyText,
  getToolDisplayName,
  TOOL_STATUS_LABELS
} from "./tool-presentation.js";
export type {
  ToolPresentation,
  ToolPresentationKind,
  ToolPresenter
} from "./tool-presentation.js";
