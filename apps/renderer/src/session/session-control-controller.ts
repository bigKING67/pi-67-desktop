import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import type { TaskProtocolContext } from "@pi67/protocol";
import { runSessionResourceCatalogTransition } from "../app/session-transition.js";
import {
  acceptRendererSessionResponse,
  currentRendererSessionAuthority,
  type RendererSessionAuthority
} from "./session-authority.js";
import {
  useSessionProjectionStore,
  type SessionProjectionAuthorityState
} from "./session-projection-store.js";
import type { SessionProjectionTarget } from "./session-projection-revisions.js";
import {
  beginModelSelection,
  confirmModelSelection,
  failModelSelection,
  isPendingModelSelection,
  modelSelectionTargetKey,
  resetModelSelection,
  useModelSelectionStore,
  type ModelSelectionTarget,
  type ModelSelectionToken
} from "./model-selection-store.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import {
  rendererWorkbenchStore,
  taskForConversation,
  type RendererWorkbenchState,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";

interface ModelSelectionFlight {
  key: string;
  promise: Promise<void>;
}

let modelSelectionFlight: ModelSelectionFlight | undefined;

export function selectSessionModel(
  provider: string,
  id: string
): Promise<void> {
  const get = useAppStore.getState;
  let authority: RendererSessionAuthority;
  let projectionTarget: SessionProjectionTarget;
  let modelTarget: ModelSelectionTarget;
  try {
    authority = requireSessionAuthority(get());
    projectionTarget = requireProjectionTarget(authority);
    modelTarget = resolveModelSelectionTarget(provider, id);
  } catch (error) {
    publishActionError(error, "无法切换模型");
    return Promise.resolve();
  }

  const requestKey = `${authority.hostEpoch}:${authority.sessionId}:${authority.sessionGeneration}:${provider}/${id}`;
  if (modelSelectionFlight?.key === requestKey) return modelSelectionFlight.promise;
  const selection = useModelSelectionStore.getState();
  if (
    selection.status !== "pending"
    && modelSelectionTargetKey(useSessionProjectionStore.getState().controls?.selectedModel)
      === modelSelectionTargetKey(modelTarget)
  ) return Promise.resolve();

  const token = beginModelSelection(authority, modelTarget);
  let promise!: Promise<void>;
  promise = performModelSelection(
    get,
    authority,
    projectionTarget,
    modelTarget,
    token
  ).finally(() => {
    if (modelSelectionFlight?.promise === promise) modelSelectionFlight = undefined;
  });
  modelSelectionFlight = { key: requestKey, promise };
  return promise;
}

export async function configureRuntimeProviderKey(
  provider: string,
  apiKey: string,
  context?: TaskProtocolContext
): Promise<boolean> {
  const get = useAppStore.getState;
  try {
    const authority = requireSessionAuthority(get());
    const target = requireProjectionTarget(authority);
    const result = await agentConnectionController.request(
      "model.setRuntimeKey",
      { provider, apiKey },
      [],
      context ? { context } : {}
    );
    if (!acceptRendererSessionResponse(get(), authority)) {
      publishNotification({
        level: "warning",
        title: messages.credentials.staleConfirmationTitle,
        message: "Pi 运行服务或会话已在确认期间替换，请重新提交。"
      });
      return false;
    }
    if (!applyProjectionResponse(
      get,
      authority,
      () => useSessionProjectionStore.getState().applyModelCatalogResult(target, result)
    )) {
      publishNotification({
        level: "warning",
        title: messages.credentials.stateNeedsConfirmationTitle,
        message: "Pi 运行服务或会话已在状态安装期间替换，请重新打开凭据面板确认。"
      });
      return false;
    }
    publishNotification({
      level: "info",
      title: messages.credentials.enabledTitle(provider),
      message: messages.credentials.ephemeralNotice
    });
    return true;
  } catch (error) {
    publishActionError(error, messages.credentials.enableFailedTitle);
    return false;
  }
}

export async function setSessionThinkingLevel(
  level: string
): Promise<void> {
  const get = useAppStore.getState;
  try {
    const authority = requireSessionAuthority(get());
    const target = requireProjectionTarget(authority);
    const result = await agentConnectionController.request("thinking.set", { level });
    applyProjectionResponse(
      get,
      authority,
      () => useSessionProjectionStore.getState().applyControlResult(target, result)
    );
  } catch (error) {
    publishActionError(error, "无法调整思考级别");
  }
}

export async function reloadSessionResources(): Promise<void> {
  const get = useAppStore.getState;
  const set = useAppStore.setState;
  const unavailable = sessionResourceReloadUnavailableReason(
    get(),
    useSessionProjectionStore.getState().authority,
    currentSessionResourceTask(rendererWorkbenchStore.getState())
  );
  if (unavailable) {
    publishNotification({
      level: "info",
      title: "暂时无法重新加载 Pi 资源",
      message: unavailable
    });
    return;
  }
  await runSessionResourceCatalogTransition(get, set, {
    detail: "正在重新加载 Pi 资源",
    readyDetail: "Pi 资源已重新加载",
    onError: (error) => publishRuntimeError(error, "无法重新加载 Pi 资源"),
    request: () => agentConnectionController.request("resource.reload", {})
  });
}

export function sessionResourceReloadUnavailableReason(
  state: Pick<AppState, "connected" | "hostEpoch" | "sessionTransitionPending">,
  projectionAuthority: SessionProjectionAuthorityState,
  task: RendererWorkbenchTask | undefined
): string | undefined {
  if (state.sessionTransitionPending) return messages.composer.piActionUnavailable.transition;
  if (!state.connected || state.hostEpoch === undefined) {
    return messages.composer.piActionUnavailable.disconnected;
  }
  if (!sessionResourceProjectionMatchesTask(task, projectionAuthority, state.hostEpoch)) {
    return messages.composer.piActionUnavailable.session;
  }
  return undefined;
}

export function currentSessionResourceTask(
  state: Pick<RendererWorkbenchState, "selectedSurface" | "settingsReturnSurface" | "tasks">
): RendererWorkbenchTask | undefined {
  const surface = state.selectedSurface?.kind === "settings"
    ? state.settingsReturnSurface
    : state.selectedSurface;
  return surface?.kind === "conversation"
    ? taskForConversation(state.tasks, surface.conversation)
    : undefined;
}

export function sessionResourceProjectionMatchesTask(
  task: RendererWorkbenchTask | undefined,
  projectionAuthority: SessionProjectionAuthorityState,
  hostEpoch: number | undefined
): boolean {
  return task?.conversation.kind === "session"
    && task.conversation.sessionFileIdentity === task.sessionFileIdentity
    && task.sessionFileIdentity !== undefined
    && task.sessionGeneration !== undefined
    && hostEpoch !== undefined
    && projectionAuthority.phase === "active"
    && projectionAuthority.hostEpoch === hostEpoch
    && projectionAuthority.sessionId === task.sessionId
    && projectionAuthority.sessionFileIdentity === task.sessionFileIdentity
    && projectionAuthority.sessionGeneration === task.sessionGeneration;
}

function requireSessionAuthority(state: AppState): RendererSessionAuthority {
  const authority = currentRendererSessionAuthority(state);
  if (!authority) throw new Error("Pi 会话身份尚未就绪。");
  return authority;
}

function requireProjectionTarget(authority: RendererSessionAuthority): SessionProjectionTarget {
  const target = useSessionProjectionStore.getState().capture(authority);
  if (!target) throw new Error("Renderer Session projection is not current.");
  return target;
}

async function performModelSelection(
  get: () => AppState,
  authority: RendererSessionAuthority,
  projectionTarget: SessionProjectionTarget,
  modelTarget: ModelSelectionTarget,
  token: ModelSelectionToken
): Promise<void> {
  try {
    const result = await agentConnectionController.request("model.select", {
      provider: modelTarget.provider,
      id: modelTarget.id
    });
    if (!isPendingModelSelection(token)) return;
    if (!acceptRendererSessionResponse(get(), authority)) {
      resetModelSelection();
      return;
    }

    const resultMatchesTarget = modelSelectionTargetKey(result.controls.selectedModel)
      === modelSelectionTargetKey(modelTarget);
    if (resultMatchesTarget) {
      useSessionProjectionStore.getState().applyModelCatalogResult(projectionTarget, result);
    }
    if (!acceptRendererSessionResponse(get(), authority)) {
      if (isPendingModelSelection(token)) resetModelSelection();
      return;
    }
    if (authoritativeModelMatches(modelTarget)) {
      confirmModelSelection(token);
      return;
    }
    await recoverModelSelectionProjection(get, authority, modelTarget, token);
  } catch (error) {
    if (!isPendingModelSelection(token)) return;
    const detail = errorMessage(error);
    failModelSelection(token, detail);
    publishActionError(error, "无法切换模型");
  }
}

async function recoverModelSelectionProjection(
  get: () => AppState,
  authority: RendererSessionAuthority,
  modelTarget: ModelSelectionTarget,
  token: ModelSelectionToken
): Promise<void> {
  const disposition = await resynchronizeRendererProjection(
    get,
    useAppStore.setState,
    {
      hostEpoch: authority.hostEpoch,
      recoveringDetail: messages.composer.confirmingModelSwitch(modelTarget.label),
      readyDetail: messages.composer.modelSwitched(modelTarget.label),
      failureTitle: messages.composer.modelSwitchConfirmationFailed
    }
  );
  if (!isPendingModelSelection(token)) return;
  if (disposition === "committed" && authoritativeModelMatches(modelTarget)) {
    confirmModelSelection(token);
    return;
  }
  const detail = messages.composer.modelSwitchStateUnconfirmed;
  if (!failModelSelection(token, detail) || disposition === "failed") return;
  publishNotification({
    level: "error",
    title: messages.composer.modelSwitchConfirmationFailed,
    message: detail
  });
}

function resolveModelSelectionTarget(provider: string, id: string): ModelSelectionTarget {
  const model = useSessionProjectionStore.getState().modelCatalog?.models.find((candidate) => (
    candidate.provider === provider && candidate.id === id
  ));
  return { provider, id, label: model?.label ?? `${provider}/${id}` };
}

function authoritativeModelMatches(target: ModelSelectionTarget): boolean {
  return modelSelectionTargetKey(useSessionProjectionStore.getState().controls?.selectedModel)
    === modelSelectionTargetKey(target);
}

function applyProjectionResponse(
  get: () => AppState,
  authority: RendererSessionAuthority,
  apply: () => boolean
): boolean {
  if (!acceptRendererSessionResponse(get(), authority)) return false;
  return apply()
    && acceptRendererSessionResponse(get(), authority);
}

function publishActionError(error: unknown, title: string): void {
  publishNotification({
    level: "error",
    title,
    message: error instanceof Error ? error.message : "未知错误"
  });
}

function publishRuntimeError(error: unknown, title: string): void {
  const detail = errorMessage(error);
  publishNotification({ level: "error", title, message: detail });
  useAppStore.setState({
    runtime: { phase: "failed", detail: `${title}：${detail}`, recoverable: true }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
