import type { AppState } from "../app/app-store.types.js";
import { useAppStore } from "../app/app-store.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";

const SESSION_CREATION_AUTHORITY_TIMEOUT_MS = 10_000;

export async function ensureRendererSessionCreationAuthority(): Promise<void> {
  const deadline = performance.now() + SESSION_CREATION_AUTHORITY_TIMEOUT_MS;
  const identity = await settleBeforeDeadline(
    ensureAgentConnection(),
    deadline,
    "Pi 运行服务连接超时，请稍候后重试。"
  );
  await waitForRendererConnectionAuthority(identity.hostEpoch, deadline);
}

function waitForRendererConnectionAuthority(hostEpoch: number, deadline: number): Promise<void> {
  const ready = (state: AppState) => (
    state.connected
    && state.hostEpoch === hostEpoch
    && state.connectionIdentity?.hostEpoch === hostEpoch
    && !state.sessionTransitionPending
  );
  if (ready(useAppStore.getState())) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error("Pi 运行服务尚未完成会话恢复，请稍候后重试。"));
    }, remainingDeadlineMs(deadline));
    unsubscribe = useAppStore.subscribe((state) => {
      if (ready(state)) finish();
    });
    if (ready(useAppStore.getState())) finish();
  });
}

function settleBeforeDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), remainingDeadlineMs(deadline));
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function remainingDeadlineMs(deadline: number): number {
  return Math.max(1, Math.ceil(deadline - performance.now()));
}
