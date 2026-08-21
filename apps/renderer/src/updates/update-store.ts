import { create } from "zustand";
import {
  idleUpdateState,
  parseUpdateState,
  updateErrorState,
  type UpdateState
} from "./update-state.js";

interface UpdateStoreState {
  update: UpdateState;
  initialized: boolean;
  install: (update: UpdateState) => void;
}

export const useUpdateStore = create<UpdateStoreState>((set) => ({
  update: idleUpdateState,
  initialized: false,
  install(update) { set({ update, initialized: true }); }
}));

export function initializeUpdateProjection(): () => void {
  let active = true;
  let eventRevision = 0;
  const unsubscribe = window.pi67.system.onUpdateStateChanged((value) => {
    if (!active) return;
    eventRevision += 1;
    useUpdateStore.getState().install(parseUpdateState(value));
  });
  const revisionAtLoad = eventRevision;
  void window.pi67.system.getUpdateState().then((value) => {
    if (!active || eventRevision !== revisionAtLoad) return;
    useUpdateStore.getState().install(parseUpdateState(value));
  }).catch(() => {
    if (!active || eventRevision !== revisionAtLoad) return;
    useUpdateStore.getState().install(updateErrorState(
      "无法读取更新服务状态；没有执行网络请求。"
    ));
  });
  return () => {
    active = false;
    unsubscribe();
  };
}

export async function checkForUpdatesNow(): Promise<UpdateState> {
  try {
    const update = parseUpdateState(await window.pi67.system.checkForUpdates());
    useUpdateStore.getState().install(update);
    return update;
  } catch {
    const current = useUpdateStore.getState().update;
    const update = updateErrorState(
      "更新检查失败。当前版本和 Pi 会话保持不变，请稍后重试。",
      current.currentVersion,
      current.automaticChecks
    );
    useUpdateStore.getState().install(update);
    return update;
  }
}

export async function startUpdateNow(): Promise<UpdateState> {
  try {
    const update = parseUpdateState(await window.pi67.system.startUpdate());
    useUpdateStore.getState().install(update);
    return update;
  } catch {
    const current = useUpdateStore.getState().update;
    const update = updateErrorState(
      "更新下载或安装没有启动。当前版本和 Pi 会话保持不变，可以重新检查后再试。",
      current.currentVersion,
      current.automaticChecks
    );
    useUpdateStore.getState().install(update);
    return update;
  }
}

export async function cancelUpdateNow(): Promise<UpdateState> {
  try {
    const update = parseUpdateState(await window.pi67.system.cancelUpdate());
    useUpdateStore.getState().install(update);
    return update;
  } catch {
    return useUpdateStore.getState().update;
  }
}
