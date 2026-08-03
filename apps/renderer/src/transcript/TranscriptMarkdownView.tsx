import type { ComponentProps } from "react";
import { useCallback } from "react";
import { openWorkspaceFileByRelativePath } from "../workspace-files/workspace-file-controller.js";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import { MarkdownView } from "./MarkdownView.js";

export function TranscriptMarkdownView(props: ComponentProps<typeof MarkdownView>) {
  const workspace = useWorkbenchStore((state) => {
    const task = selectedWorkbenchTask(state);
    const workspaceId = task?.workspaceId ?? state.currentWorkspaceId;
    return workspaceId ? state.workspaces[workspaceId] : undefined;
  });
  const openWorkspacePath = useCallback(async (target: {
    relativePath: string;
    fragment?: string;
  }): Promise<void> => {
    if (!workspace) return;
    await openWorkspaceFileByRelativePath(workspace, target.relativePath);
  }, [workspace]);

  return (
    <MarkdownView
      {...props}
      {...(workspace === undefined ? {} : { onOpenWorkspacePath: openWorkspacePath })}
    />
  );
}
