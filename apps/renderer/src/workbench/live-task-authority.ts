import type { RendererWorkbenchTask } from "./workbench-store.js";

export function taskMatchesLiveSessionAuthority(
  task: RendererWorkbenchTask | undefined,
  liveSessionId: string | undefined,
  liveSessionFileIdentity: string | undefined,
  liveSessionGeneration: number | undefined
): boolean {
  return Boolean(
    task
    && liveSessionId
    && liveSessionFileIdentity
    && liveSessionGeneration !== undefined
    && task.sessionGeneration !== undefined
    && task.sessionId === liveSessionId
    && task.sessionFileIdentity === liveSessionFileIdentity
    && task.sessionGeneration === liveSessionGeneration
  );
}

export function canRenderLiveTask(
  task: RendererWorkbenchTask | undefined,
  liveSessionId: string | undefined,
  liveSessionFileIdentity: string | undefined,
  liveSessionGeneration: number | undefined
): boolean {
  if (!task) return false;
  return taskMatchesLiveSessionAuthority(
    task,
    liveSessionId,
    liveSessionFileIdentity,
    liveSessionGeneration
  ) && task.runtime.phase !== "stopped"
    && task.lifecycle !== "lost"
    && task.lifecycle !== "stopped";
}
