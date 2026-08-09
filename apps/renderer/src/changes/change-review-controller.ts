import type {
  ChangeReviewAnchor,
  ChangeReviewAuthority,
  ComposerReviewComment,
  ComposerWorkspaceFileRef,
  WorkspaceDescriptor
} from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { workspaceChangeFingerprint } from "./changes-read-store.js";
import { useRepositoryWorkingTreeStore } from "./repository-working-tree-store.js";
import { useWorkspaceChangesStore } from "./workspace-changes-store.js";

const MAX_PROMPT_TEXT_CHARS = 2_000_000;

export type AddReviewCommentResult =
  | { ok: true; comment: ComposerReviewComment }
  | { ok: false; message: string };

export type PreparedReviewSubmission =
  | {
      ok: true;
      text: string;
      workspaceFiles: ComposerWorkspaceFileRef[];
      commentIds: string[];
    }
  | { ok: false; message: string };

export async function addComposerReviewComment(input: {
  taskId: string;
  authority: ChangeReviewAuthority;
  anchor: ChangeReviewAnchor;
  path: string;
  body: string;
}): Promise<AddReviewCommentResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, message: "请输入修改意见。" };
  if (!reviewAuthorityCurrent(input.taskId, input.authority)) {
    return { ok: false, message: "这条 Diff 已变化，请刷新后重新选择行。" };
  }
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[input.taskId];
  const workspace = task ? workbench.workspaces[task.workspaceId] : undefined;
  if (!task || !workspace || task.workspaceId !== input.authority.workspaceId) {
    return { ok: false, message: "当前任务与修改来源不再匹配。" };
  }
  const relativePath = relativeReviewPath(workspace, input.path);
  if (!relativePath) {
    return { ok: false, message: "修改路径不在当前工作区内，无法绑定安全文件引用。" };
  }
  try {
    if (!await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false })) {
      throw new Error("工作区当前不可用。");
    }
    const result = await agentConnectionController.request(
      "workspace.file.resolve",
      { relativePath },
      [],
      { context: { scope: "workspace", workspaceId: workspace.id } }
    );
    if (result.entry.kind !== "file") throw new Error("修改路径没有指向普通文件。");
    if (!reviewAuthorityCurrent(input.taskId, input.authority)) {
      return { ok: false, message: "解析文件期间 Diff 已变化，请重新选择行。" };
    }
    const comment: ComposerReviewComment = {
      id: crypto.randomUUID(),
      authority: { ...input.authority },
      anchor: { ...input.anchor },
      body,
      createdAt: Date.now(),
      file: {
        id: result.entry.id,
        revision: result.entry.revision,
        relativePath: result.entry.relativePath
      }
    };
    const added = useTaskDraftStore.getState().addReviewComment(input.taskId, comment);
    if (added === "full") return { ok: false, message: "本任务的待发送修改意见已达到 64 条上限。" };
    if (added === "too-large") return { ok: false, message: "修改意见超出 16 KiB 单条或 256 KiB 总量上限。" };
    if (added === "duplicate") return { ok: false, message: "这条修改意见已存在。" };
    return { ok: true, comment };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "无法绑定工作区文件。" };
  }
}

export function prepareComposerReviewSubmission(
  taskId: string,
  baseText: string,
  workspaceFiles: readonly ComposerWorkspaceFileRef[]
): PreparedReviewSubmission {
  const comments = useTaskDraftStore.getState().drafts[taskId]?.reviewComments ?? [];
  if (comments.length === 0) {
    return { ok: true, text: baseText, workspaceFiles: workspaceFiles.map((file) => ({ ...file })), commentIds: [] };
  }
  const stale = comments.filter((comment) => !reviewAuthorityCurrent(taskId, comment.authority));
  if (stale.length > 0) {
    return {
      ok: false,
      message: `有 ${stale.length} 条修改意见对应的 Diff 已变化。请删除旧意见或刷新后重新批注。`
    };
  }
  const text = formatReviewPrompt(baseText, comments);
  if (text.length > MAX_PROMPT_TEXT_CHARS) {
    return { ok: false, message: "正文与修改意见合并后超过消息长度上限，请缩短后重试。" };
  }
  const files = mergeWorkspaceFiles(workspaceFiles, comments.map((comment) => comment.file));
  return {
    ok: true,
    text,
    workspaceFiles: files,
    commentIds: comments.map((comment) => comment.id)
  };
}

export function reviewCommentIdsAcceptedBySubmission(
  result: { accepted: boolean; terminalError?: string | undefined },
  commentIds: readonly string[]
): string[] {
  return result.accepted && result.terminalError === undefined ? [...commentIds] : [];
}

export function reviewAuthorityCurrent(taskId: string, authority: ChangeReviewAuthority): boolean {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  if (!task || task.workspaceId !== authority.workspaceId) return false;
  if (authority.source === "session") {
    if (
      task.conversation.kind !== "session"
      || task.sessionFileIdentity !== authority.sessionFileIdentity
    ) return false;
    const state = useWorkspaceChangesStore.getState();
    const change = state.byToolCallId.get(authority.toolCallId);
    return state.status === "ready"
      && state.authority?.sessionId === task.sessionId
      && state.authority.sessionGeneration === task.sessionGeneration
      && change?.kind === "edit"
      && change.status === "completed"
      && change.patch !== undefined
      && !change.patchTruncated
      && workspaceChangeFingerprint(change) === authority.contentFingerprint;
  }
  const state = useRepositoryWorkingTreeStore.getState();
  const snapshot = state.snapshot;
  const detail = state.detailByChangeId[authority.changeId];
  return state.status === "ready"
    && snapshot?.workspaceId === authority.workspaceId
    && snapshot.revision === authority.revision
    && detail?.workspaceId === authority.workspaceId
    && detail.revision === authority.revision
    && detail.contentFingerprint === authority.contentFingerprint
    && !detail.truncated;
}

export function reviewAuthorityEquals(
  left: ChangeReviewAuthority,
  right: ChangeReviewAuthority
): boolean {
  if (left.source !== right.source || left.workspaceId !== right.workspaceId) return false;
  if (left.source === "session" && right.source === "session") {
    return left.sessionFileIdentity === right.sessionFileIdentity
      && left.toolCallId === right.toolCallId
      && left.contentFingerprint === right.contentFingerprint;
  }
  if (left.source === "worktree" && right.source === "worktree") {
    return left.revision === right.revision
      && left.changeId === right.changeId
      && left.contentFingerprint === right.contentFingerprint;
  }
  return false;
}

function formatReviewPrompt(baseText: string, comments: readonly ComposerReviewComment[]): string {
  const sorted = [...comments].sort((left, right) => (
    left.file.relativePath.localeCompare(right.file.relativePath)
    || left.anchor.section.localeCompare(right.anchor.section)
    || left.anchor.startLine - right.anchor.startLine
    || left.createdAt - right.createdAt
  ));
  const review = sorted.map((comment, index) => {
    const side = comment.anchor.side === "new" ? "新" : "旧";
    const lines = comment.anchor.startLine === comment.anchor.endLine
      ? `${side}第 ${comment.anchor.startLine} 行`
      : `${side}第 ${comment.anchor.startLine}-${comment.anchor.endLine} 行`;
    const section = comment.anchor.section === "staged"
      ? "staged"
      : comment.anchor.section === "unstaged" ? "unstaged" : "session";
    return `${index + 1}. \`${comment.file.relativePath}\` · ${section} · ${lines}\n${comment.body}`;
  }).join("\n\n");
  const heading = "## 修改审阅意见\n请逐条处理以下绑定到当前 exact Diff 的意见；不要忽略行号与文件上下文。";
  return baseText ? `${baseText}\n\n${heading}\n\n${review}` : `${heading}\n\n${review}`;
}

function mergeWorkspaceFiles(
  primary: readonly ComposerWorkspaceFileRef[],
  reviewFiles: readonly ComposerWorkspaceFileRef[]
): ComposerWorkspaceFileRef[] {
  const result: ComposerWorkspaceFileRef[] = [];
  const seen = new Set<string>();
  for (const file of [...primary, ...reviewFiles]) {
    const key = `${file.id}\0${file.revision}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...file });
  }
  return result;
}

function relativeReviewPath(workspace: WorkspaceDescriptor, path: string): string | undefined {
  const candidate = normalizePath(path);
  const root = normalizePath(workspace.identity.canonicalPath).replace(/\/+$/u, "");
  if (!candidate || candidate.includes("\0")) return undefined;
  if (!isAbsolutePath(candidate)) return safeRelativePath(candidate);
  const insensitive = /^[A-Za-z]:\//u.test(root);
  const comparableRoot = insensitive ? root.toLowerCase() : root;
  const comparableCandidate = insensitive ? candidate.toLowerCase() : candidate;
  if (!comparableCandidate.startsWith(`${comparableRoot}/`)) return undefined;
  return safeRelativePath(candidate.slice(root.length + 1));
}

function safeRelativePath(path: string): string | undefined {
  const normalized = path.replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (!normalized) return undefined;
  const segments = normalized.split("/");
  return segments.some((segment) => !segment || segment === "." || segment === "..")
    ? undefined
    : normalized;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//u.test(path);
}
