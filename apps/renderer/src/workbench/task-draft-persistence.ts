import {
  MAX_COMPOSER_DRAFTS,
  MAX_COMPOSER_DRAFT_TEXT_BYTES,
  MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL,
  MAX_COMPOSER_REVIEW_COMMENTS,
  MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES,
  MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES_TOTAL,
  MAX_PROMPT_STASH_ITEMS,
  MAX_PROMPT_STASH_TEXT_BYTES_TOTAL,
  conversationKeyIdentity,
  type ComposerDraftPersistedState,
  type ComposerDraftRecord
} from "@pi67/domain";
import { createMessageId } from "@pi67/protocol";
import { publishNotification } from "../notifications/notification-store.js";
import {
  rendererWorkbenchStore, selectedWorkbenchTask, taskForConversation,
  type RendererWorkbenchTask
} from "./workbench-store.js";
import { taskDraftHasContent, useTaskDraftStore, type TaskDraft } from "./task-draft-store.js";
import { captureDraftRestoreSelectionGuard } from "./task-draft-restore-selection.js";
import {
  cloneReviewComment,
  draftContentFingerprint,
  taskDraftFingerprint
} from "./task-draft-fingerprint.js";

const PERSISTENCE_DELAY_MS = 500;
const PERSISTENCE_RETRY_DELAY_MS = 1_500;
const BACKGROUND_FAILURE_HISTORY_THRESHOLD = 3;
const encoder = new TextEncoder();
let initialization: Promise<void> | undefined;
let persistenceTimer: number | undefined;
let persistencePromise: Promise<void> = Promise.resolve();
let persistenceBound = false;
let suppressPersistence = false;
let shuttingDown = false;
let lastError: string | undefined;
let consecutiveBackgroundFailures = 0;
let limitWarningPublished = false;
let secureStorageUnavailable = false;
const updatedAtByConversation = new Map<string, number>();
const contentFingerprintByConversation = new Map<string, string>();
export function initializeTaskDraftPersistence(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}

async function initialize(): Promise<void> {
  const restoreSelectionGuard = captureDraftRestoreSelectionGuard();
  try {
    const snapshot = await window.pi67.system.loadComposerDraftState();
    suppressPersistence = true;
    restorePersistedDrafts(snapshot.state, {
      restoreSelection: restoreSelectionGuard.release()
    });
    secureStorageUnavailable = snapshot.persistence === "unavailable";
    if (snapshot.recovery === "backup-restored") {
      publishNotification({
        level: "warning",
        title: "对话草稿已从备份恢复",
        message: "主草稿状态文件不可用，已使用最近一次完整备份。Pi 会话未受影响。"
      });
    } else if (snapshot.recovery === "corrupt-reset") {
      publishNotification({
        level: "warning",
        title: "对话草稿状态已重置",
        message: "保存的草稿状态损坏并已隔离，Pi 会话和项目文件未受影响。"
      });
    } else if (snapshot.recovery === "draft-decrypt-failed") {
      publishNotification({
        level: "warning",
        title: "对话草稿无法解密",
        message: "无法解密的草稿未载入，Pi 会话和项目文件未受影响。"
      });
    }
    if (snapshot.persistence === "unavailable") {
      publishNotification({
        level: "warning",
        title: "对话草稿仅保留在当前窗口",
        message: "系统安全存储不可用，Desktop 不会把 Prompt 草稿以明文写入磁盘。"
      });
    }
  } catch (error) {
    publishPersistenceWarning(error);
  } finally {
    restoreSelectionGuard.release();
    suppressPersistence = false;
  }

  persistenceBound = true;
  useTaskDraftStore.subscribe((state) => {
    synchronizeTaskDraftFlags(state.drafts);
    schedulePersistence();
  });
  rendererWorkbenchStore.subscribe(() => schedulePersistence());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void persistTaskDraftState();
  });
  window.addEventListener("beforeunload", () => {
    shuttingDown = true;
    void persistTaskDraftState();
  });
}

export function restorePersistedDrafts(
  state: ComposerDraftPersistedState,
  options: { restoreSelection: boolean } = { restoreSelection: true }
): void {
  const restoredTaskByConversation = new Map<string, string>();
  for (const record of state.drafts) {
    const workbench = rendererWorkbenchStore.getState();
    if (!workbench.workspaces[record.conversation.workspaceId]) continue;
    const existing = taskForConversation(workbench.tasks, record.conversation);
    const taskId = existing?.id ?? workbench.restoreTask(restoredTask(record));
    if (!taskId) continue;
    const identity = conversationKeyIdentity(record.conversation);
    updatedAtByConversation.set(identity, record.updatedAt);
    contentFingerprintByConversation.set(identity, draftContentFingerprint(record));
    const restored = useTaskDraftStore.getState().restore(taskId, record);
    if (restored === "conflict") continue;
    const draft = useTaskDraftStore.getState().drafts[taskId];
    rendererWorkbenchStore.getState().updateTask(taskId, {
      hasDraft: Boolean(draft && (
        draft.text.trim()
        || draft.workspaceFiles.length > 0
        || draft.reviewComments.length > 0
        || draft.promptStash.length > 0
      )),
      attachmentCount: draft?.attachments.length ?? 0,
      ...(record.environmentIntent ? { environmentIntent: record.environmentIntent } : {})
    });
    restoredTaskByConversation.set(identity, taskId);
  }

  const selected = state.selectedConversation
    ? restoredTaskByConversation.get(conversationKeyIdentity(state.selectedConversation))
    : undefined;
  if (selected && options.restoreSelection) rendererWorkbenchStore.getState().selectTask(selected);
}

function restoredTask(record: ComposerDraftRecord): RendererWorkbenchTask {
  const conversation = record.conversation;
  const taskId = conversation.kind === "provisional"
    ? conversation.draftId
    : createMessageId("draft-task");
  return {
    id: taskId,
    conversation,
    workspaceId: conversation.workspaceId,
    sessionId: `pending:${taskId}`,
    taskGeneration: 1,
    ...(conversation.kind === "session"
      ? {
          sessionFileIdentity: conversation.sessionFileIdentity,
          sessionPath: conversation.sessionPath
        }
      : {}),
    lifecycle: conversation.kind === "provisional" ? "draft" : "stopped",
    runtime: {
      phase: "stopped",
      detail: conversation.kind === "provisional" ? "首条消息尚未发送" : "对话草稿等待恢复",
      recoverable: true
    },
    title: "未命名会话",
    titleSource: "fallback",
    ...(record.environmentIntent ? { environmentIntent: record.environmentIntent } : {}),
    hasDraft: true,
    attachmentCount: 0,
    toolMode: "auto"
  };
}

function synchronizeTaskDraftFlags(drafts: Record<string, TaskDraft>): void {
  if (suppressPersistence) return;
  const workbench = rendererWorkbenchStore.getState();
  for (const task of Object.values(workbench.tasks)) {
    const draft = drafts[task.id];
    const hasDraft = Boolean(draft && taskDraftHasContent(draft));
    const attachmentCount = draft?.attachments.length ?? 0;
    if (task.hasDraft === hasDraft && task.attachmentCount === attachmentCount) continue;
    workbench.updateTask(task.id, { hasDraft, attachmentCount });
  }
}

function schedulePersistence(): void {
  if (!persistenceBound || suppressPersistence || shuttingDown) return;
  if (persistenceTimer !== undefined) window.clearTimeout(persistenceTimer);
  persistenceTimer = window.setTimeout(() => {
    persistenceTimer = undefined;
    void persistTaskDraftState();
  }, PERSISTENCE_DELAY_MS);
}

type PersistenceFeedback = "background" | "checkpoint" | "caller-owned";
export type TaskDraftPersistenceOutcome = "persisted" | "secure-storage-unavailable" | "failed";

function persistTaskDraftState(
  requiredTaskId?: string,
  feedback: PersistenceFeedback = "background",
  removedPromptStashItemId?: string
): Promise<TaskDraftPersistenceOutcome> {
  if (persistenceTimer !== undefined) {
    window.clearTimeout(persistenceTimer);
    persistenceTimer = undefined;
  }
  const state = serializeTaskDraftState();
  if (requiredTaskId && !serializedStateIncludesTaskDraft(state, requiredTaskId, removedPromptStashItemId)) {
    return Promise.resolve("failed");
  }
  if (feedback === "background" && secureStorageUnavailable) {
    return Promise.resolve("secure-storage-unavailable");
  }
  let outcome: TaskDraftPersistenceOutcome = "failed";
  const operation = persistencePromise.then(async () => {
    try {
      const snapshot = await window.pi67.system.updateComposerDraftState(state);
      if (snapshot.persistence === "unavailable") {
        secureStorageUnavailable = true;
        outcome = "secure-storage-unavailable";
        if (feedback === "background") publishSecureStorageUnavailableWarning();
        return;
      }
      secureStorageUnavailable = false;
      lastError = undefined;
      consecutiveBackgroundFailures = 0;
      outcome = "persisted";
    } catch (error) {
      if (feedback === "background") {
        reportBackgroundPersistenceError(error);
        schedulePersistenceRetry();
      } else if (feedback === "checkpoint") {
        publishPersistenceWarning(error);
      }
    }
  });
  persistencePromise = operation;
  return operation.then(() => outcome);
}

export async function persistTaskDraftStateCheckpoint(): Promise<void> {
  if (await persistTaskDraftState(undefined, "checkpoint") !== "persisted") {
    throw new Error("Composer draft checkpoint failed.");
  }
}

export function beginTaskDraftShutdown(): void {
  shuttingDown = true;
  if (persistenceTimer !== undefined) window.clearTimeout(persistenceTimer);
  persistenceTimer = undefined;
}

export function persistTaskDraftStateAcknowledged(taskId?: string): Promise<TaskDraftPersistenceOutcome> {
  return persistTaskDraftState(taskId, "caller-owned");
}

export function persistPromptStashRemovalAcknowledged(
  taskId: string,
  itemId: string
): Promise<TaskDraftPersistenceOutcome> {
  return persistTaskDraftState(taskId, "caller-owned", itemId);
}

export function serializeTaskDraftState(now = Date.now()): ComposerDraftPersistedState {
  const workbench = rendererWorkbenchStore.getState();
  const drafts = useTaskDraftStore.getState().drafts;
  const candidateByConversation = new Map<string, ComposerDraftRecord>();
  for (const [taskId, draft] of Object.entries(drafts)) {
    const task = workbench.tasks[taskId];
    if (!task || (
      draft.text.length === 0
      && draft.reviewComments.length === 0
      && draft.promptStash.length === 0
      && draft.startupModel === undefined
      && draft.startupThinkingLevel === undefined
    )) continue;
    const textBytes = encoder.encode(draft.text).byteLength;
    const reviewBytes = draft.reviewComments.reduce(
      (total, comment) => total + encoder.encode(comment.body).byteLength,
      0
    );
    const stashBytes = draft.promptStash.reduce((total, item) => total + encoder.encode(item.text).byteLength, 0);
    if (
      textBytes > MAX_COMPOSER_DRAFT_TEXT_BYTES
      || draft.reviewComments.length > MAX_COMPOSER_REVIEW_COMMENTS
      || draft.reviewComments.some((comment) => (
        encoder.encode(comment.body).byteLength > MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES
      ))
      || reviewBytes > MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES_TOTAL
      || draft.promptStash.length > MAX_PROMPT_STASH_ITEMS
      || stashBytes > MAX_PROMPT_STASH_TEXT_BYTES_TOTAL
    ) {
      publishLimitWarning();
      continue;
    }
    const identity = conversationKeyIdentity(task.conversation);
    const fingerprint = taskDraftFingerprint(draft, task.environmentIntent);
    if (contentFingerprintByConversation.get(identity) !== fingerprint) {
      contentFingerprintByConversation.set(identity, fingerprint);
      updatedAtByConversation.set(identity, now);
    }
    candidateByConversation.set(identity, {
      conversation: task.conversation,
      text: draft.text,
      streamBehavior: draft.streamBehavior,
      updatedAt: updatedAtByConversation.get(identity) ?? now,
      ...(draft.workspaceFiles.length > 0
        ? { workspaceFiles: draft.workspaceFiles.map((reference) => ({ ...reference })) }
        : {}),
      ...(draft.reviewComments.length > 0
        ? { reviewComments: draft.reviewComments.map(cloneReviewComment) }
        : {}),
      ...(draft.promptStash.length > 0
        ? { promptStash: draft.promptStash.map((item) => ({
            ...item,
            ...(item.attachments ? { attachments: item.attachments.map((attachment) => ({ ...attachment })) } : {})
          })) }
        : {}),
      ...(task.conversation.kind === "provisional" && task.environmentIntent === "worktree"
        ? { environmentIntent: "worktree" as const }
        : {}),
      ...(task.conversation.kind === "provisional" && draft.interactionMode === "plan"
        ? { interactionMode: "plan" as const }
        : {}),
      ...(task.conversation.kind === "provisional" && draft.startupModel
        ? { startupModel: { ...draft.startupModel } } : {}),
      ...(task.conversation.kind === "provisional" && draft.startupThinkingLevel
        ? { startupThinkingLevel: draft.startupThinkingLevel } : {})
    });
  }

  const candidates = [...candidateByConversation.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const bounded: ComposerDraftRecord[] = [];
  let totalTextBytes = 0;
  let totalPromptStashBytes = 0;
  for (const candidate of candidates) {
    const textBytes = encoder.encode(candidate.text).byteLength
      + (candidate.reviewComments ?? []).reduce(
        (total, comment) => total + encoder.encode(comment.body).byteLength,
        0
      )
      + (candidate.promptStash ?? []).reduce((total, item) => total + encoder.encode(item.text).byteLength, 0);
    const promptStashBytes = (candidate.promptStash ?? []).reduce(
      (total, item) => total + encoder.encode(item.text).byteLength,
      0
    );
    if (
      bounded.length >= MAX_COMPOSER_DRAFTS
      || totalTextBytes + textBytes > MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL
      || totalPromptStashBytes + promptStashBytes > MAX_PROMPT_STASH_TEXT_BYTES_TOTAL
    ) {
      publishLimitWarning();
      continue;
    }
    bounded.push(candidate);
    totalTextBytes += textBytes;
    totalPromptStashBytes += promptStashBytes;
  }
  const included = new Set(bounded.map((draft) => conversationKeyIdentity(draft.conversation)));
  const selected = selectedWorkbenchTask(workbench);
  return {
    version: 1,
    drafts: bounded,
    ...(selected && included.has(conversationKeyIdentity(selected.conversation))
      ? { selectedConversation: selected.conversation }
      : {})
  };
}

function serializedStateIncludesTaskDraft(
  state: ComposerDraftPersistedState,
  taskId: string,
  removedPromptStashItemId?: string
): boolean {
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[taskId];
  const draft = useTaskDraftStore.getState().drafts[taskId];
  if (!task || !draft) return false;
  const record = state.drafts.find((candidate) => (
    conversationKeyIdentity(candidate.conversation) === conversationKeyIdentity(task.conversation)
  ));
  if (removedPromptStashItemId !== undefined) {
    if (draft.promptStash.some((item) => item.id === removedPromptStashItemId)) return false;
    if (!record) {
      return draft.text.length === 0
        && draft.reviewComments.length === 0
        && draft.promptStash.length === 0
        && draft.startupModel === undefined
        && draft.startupThinkingLevel === undefined;
    }
  }
  return Boolean(
    record
    && draftContentFingerprint(record) === taskDraftFingerprint(draft, task.environmentIntent)
  );
}

function publishLimitWarning(): void {
  if (limitWarningPublished) return;
  limitWarningPublished = true;
  publishNotification({
    level: "warning",
    title: "部分对话草稿无法持久化",
    message: "草稿超出安全存储上限，内容仍保留在当前窗口中。请发送、缩短或另行保存后再退出。"
  });
}

function schedulePersistenceRetry(): void {
  if (!shouldScheduleDraftPersistenceRetry(shuttingDown, persistenceTimer !== undefined)) return;
  persistenceTimer = window.setTimeout(() => {
    persistenceTimer = undefined;
    void persistTaskDraftState();
  }, PERSISTENCE_RETRY_DELAY_MS);
}

function reportBackgroundPersistenceError(error: unknown): void {
  const detail = error instanceof Error ? error.message : "对话草稿无法保存。";
  consecutiveBackgroundFailures += 1;
  if (!shouldPublishBackgroundPersistenceFailure(consecutiveBackgroundFailures, detail, lastError)) return;
  lastError = detail;
  publishNotification({
    level: "warning",
    title: "对话草稿未保存",
    message: `${detail} 草稿仍保留在当前窗口中，Desktop 将继续自动重试。`,
    toast: false
  });
}

function publishSecureStorageUnavailableWarning(): void {
  const detail = "系统安全存储不可用。";
  if (lastError === detail) return;
  lastError = detail;
  publishNotification({
    level: "warning",
    title: "对话草稿仅保留在当前窗口",
    message: "Desktop 已暂停后台重试，不会把 Prompt 草稿以明文写入磁盘。再次执行 Prompt 暂存时会重试安全存储。",
    toast: false
  });
}

function publishPersistenceWarning(error: unknown): void {
  const detail = error instanceof Error ? error.message : "对话草稿无法保存。";
  if (lastError === detail) return;
  lastError = detail;
  publishNotification({
    level: "warning",
    title: "对话草稿未保存",
    message: `${detail} 草稿仍保留在当前窗口中。`
  });
}

export function shouldScheduleDraftPersistenceRetry(isShuttingDown: boolean, timerScheduled: boolean): boolean {
  return !isShuttingDown && !timerScheduled;
}

export function shouldPublishBackgroundPersistenceFailure(
  failureCount: number, detail: string, previousDetail: string | undefined
): boolean { return failureCount >= BACKGROUND_FAILURE_HISTORY_THRESHOLD && previousDetail !== detail; }
