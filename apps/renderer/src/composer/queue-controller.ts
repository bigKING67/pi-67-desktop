import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  acceptRendererSessionResponse,
  currentRendererSessionAuthority
} from "../session/session-authority.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useAppStore } from "../app/app-store.js";

export async function clearRendererQueue(): Promise<boolean> {
  try {
    const authority = currentRendererSessionAuthority(useAppStore.getState());
    if (!authority) throw new Error("Pi 会话身份尚未就绪。");
    const projectionTarget = useSessionProjectionStore.getState().capture(authority);
    if (!projectionTarget) throw new Error("Renderer Session projection is not current.");
    await agentConnectionController.request("queue.clear", {});
    if (!acceptRendererSessionResponse(useAppStore.getState(), authority)) return false;
    useSessionProjectionStore.getState().clearQueue(projectionTarget);
    return true;
  } catch (error) {
    publishNotification({
      level: "error",
      title: "无法清空消息队列",
      message: errorMessage(error)
    });
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
