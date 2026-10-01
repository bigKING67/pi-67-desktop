import type {
  RepositoryEnvironmentSnapshot,
  TeamChatWorkCardRef,
  TeamSessionScope,
  WorkspaceDescriptor
} from "@pi67/domain";
import { useShellStore } from "../shell/shell-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { beginRendererSessionIntentInWorkspace } from "../workspace/workspace-session-controller.js";

/**
 * Chat -> Work bridge (ADR 0003). Team chat content only enters Work through a
 * team-scoped draft: its birth marker blocks private-memory capture and every
 * model call re-checks team authorization. Nothing is sent automatically.
 */
export interface StartTeamWorkInput {
  workspaceId: string;
  teamScope: TeamSessionScope;
  text: string;
}

interface WorkBridgeDependencies {
  workspace(workspaceId: string): WorkspaceDescriptor | undefined;
  showWork(): void;
  beginDraft(workspace: WorkspaceDescriptor, teamScope: TeamSessionScope): Promise<string | undefined>;
  setDraftText(taskId: string, text: string): void;
}

const DEFAULT_DEPENDENCIES: WorkBridgeDependencies = {
  workspace: (workspaceId) => rendererWorkbenchStore.getState().workspaces[workspaceId],
  showWork: () => useShellStore.getState().setWorkspaceMode("work"),
  beginDraft: (workspace, teamScope) => beginRendererSessionIntentInWorkspace(workspace, { teamScope }),
  setDraftText: (taskId, text) => useTaskDraftStore.getState().setText(taskId, text)
};

export async function startTeamWork(
  input: StartTeamWorkInput,
  dependencies: WorkBridgeDependencies = DEFAULT_DEPENDENCIES
): Promise<"started" | "unavailable" | "busy"> {
  const workspace = dependencies.workspace(input.workspaceId);
  if (!workspace || workspace.availability !== "available") return "unavailable";
  dependencies.showWork();
  const taskId = await dependencies.beginDraft(workspace, input.teamScope);
  if (!taskId) return "busy";
  dependencies.setDraftText(taskId, input.text);
  return "started";
}

/** Starting text for a Work draft taken from one chat message. */
export function chatMessageWorkBrief(source: { conversationLabel: string; senderName: string; body: string }): string {
  return `来自 ${source.conversationLabel} 的讨论（${source.senderName}）：\n\n${source.body.trim()}`;
}

/** References a hand-off may carry: Workspace name, current branch and one HTTPS link. */
export function handoffReferences(input: {
  workspaceName?: string;
  branchName?: string;
  link?: string;
}): TeamChatWorkCardRef[] {
  const refs: TeamChatWorkCardRef[] = [];
  if (input.workspaceName?.trim()) refs.push({ kind: "repository", label: input.workspaceName.trim().slice(0, 200) });
  if (input.branchName?.trim()) refs.push({ kind: "branch", label: input.branchName.trim().slice(0, 200) });
  const link = input.link?.trim();
  if (link) {
    refs.push({
      kind: /\/pull\/\d+|\/merge_requests\/\d+/u.test(link) ? "pull_request" : "link",
      label: link.slice(0, 200),
      url: link
    });
  }
  return refs;
}

/** A hand-off link must be an absolute HTTPS URL without credentials. */
export function isHandoffLink(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return true;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password && candidate.length <= 2_048;
  } catch {
    return false;
  }
}

/** The attached branch of the Workspace's current worktree, when observed and not stale. */
export function currentBranchName(snapshot: RepositoryEnvironmentSnapshot | undefined): string | undefined {
  if (!snapshot || snapshot.status !== "ready" || snapshot.stale) return undefined;
  const current = snapshot.worktrees.find((worktree) => worktree.worktreeId === snapshot.repository?.currentWorktreeId);
  return current && !current.detached ? current.branchName : undefined;
}
