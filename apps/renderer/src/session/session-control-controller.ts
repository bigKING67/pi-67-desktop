import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import { runSessionResourceCatalogTransition } from "../app/session-transition.js";
import {
  acceptRendererSessionResponse,
  currentRendererSessionAuthority,
  type RendererSessionAuthority
} from "./session-authority.js";
import {
  useSessionProjectionStore
} from "./session-projection-store.js";
import type { SessionProjectionTarget } from "./session-projection-revisions.js";

export async function selectSessionModel(
  provider: string,
  id: string
): Promise<void> {
  const get = useAppStore.getState;
  try {
    const authority = requireSessionAuthority(get());
    const target = requireProjectionTarget(authority);
    const result = await agentConnectionController.request("model.select", { provider, id });
    applyProjectionResponse(
      get,
      authority,
      () => useSessionProjectionStore.getState().applyControlResult(target, result)
    );
  } catch (error) {
    publishActionError(error, "无法切换模型");
  }
}

export async function configureRuntimeProviderKey(
  provider: string,
  apiKey: string
): Promise<boolean> {
  const get = useAppStore.getState;
  try {
    const authority = requireSessionAuthority(get());
    const target = requireProjectionTarget(authority);
    const result = await agentConnectionController.request("model.setRuntimeKey", { provider, apiKey });
    if (!acceptRendererSessionResponse(get(), authority)) {
      publishNotification({
        level: "warning",
        title: messages.credentials.staleConfirmationTitle,
        message: "Agent Host 或 Pi 会话已在确认期间替换，请重新提交。"
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
        message: "Agent Host 或 Pi 会话已在状态安装期间替换，请重新打开凭据面板确认。"
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
  await runSessionResourceCatalogTransition(get, set, {
    detail: "正在重新加载 Pi 资源",
    readyDetail: "Pi 资源已重新加载",
    onError: (error) => publishRuntimeError(error, "无法重新加载 Pi 资源"),
    request: () => agentConnectionController.request("resource.reload", {})
  });
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
  const detail = error instanceof Error ? error.message : "未知错误";
  publishNotification({ level: "error", title, message: detail });
  useAppStore.setState({
    runtime: { phase: "failed", detail: `${title}：${detail}`, recoverable: true }
  });
}
