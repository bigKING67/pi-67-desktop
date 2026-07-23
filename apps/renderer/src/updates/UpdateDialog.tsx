import { CircleCheck, Download, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";

type UpdateState =
  | { phase: "idle" | "checking" | "current" | "disabled" }
  | { phase: "available" | "downloaded"; version: string }
  | { phase: "downloading"; percent: number }
  | { phase: "error"; detail: string };

const idleState: UpdateState = { phase: "idle" };

export function UpdateDialog() {
  const open = useAppStore((state) => state.updateDialogOpen);
  const setOpen = useAppStore((state) => state.setUpdateDialogOpen);
  const [update, setUpdate] = useState<UpdateState>(idleState);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPending(false);
    void window.pi67.system.getUpdateState().then((value) => {
      if (active) setUpdate(parseUpdateState(value));
    }).catch(() => {
      if (active) setUpdate({ phase: "error", detail: "无法读取更新服务状态；没有执行网络请求。" });
    });
    const unsubscribe = window.pi67.system.onUpdateStateChanged((value) => {
      if (active) setUpdate(parseUpdateState(value));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [open]);

  if (!open) return null;
  const busy = pending || update.phase === "checking" || update.phase === "downloading";
  const action = updateAction(update);

  const runAction = async () => {
    if (!action || busy) return;
    setPending(true);
    try {
      if (action === "check") setUpdate(parseUpdateState(await window.pi67.system.checkForUpdates()));
      if (action === "download") {
        await window.pi67.system.downloadUpdate();
        setUpdate(parseUpdateState(await window.pi67.system.getUpdateState()));
      }
      if (action === "install") await window.pi67.system.installUpdate();
    } catch {
      setUpdate({ phase: "error", detail: "更新操作失败。当前版本和 Pi 会话保持不变，请稍后重试。" });
    } finally {
      setPending(false);
    }
  };

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!busy} onOpenChange={setOpen}>
      <Modal className="modal-surface update-dialog">
        <Dialog aria-label="Pi-67 Desktop 更新">
          <div className="diagnostic-dialog-content">
            <span className="dialog-eyebrow">Application updates</span>
            <Heading slot="title">Pi-67 Desktop 更新</Heading>
            <UpdateSummary update={update} pending={pending} />
            <div className="update-network-note">
              检查更新只会请求 Pi-67 Desktop 的 GitHub Release 元数据，不会发送工作区、会话、模型、Provider 或凭据数据。
            </div>
            {update.phase === "downloading" ? (
              <div className="update-progress" aria-label={`更新下载进度 ${Math.round(update.percent)}%`}>
                <span style={{ width: `${Math.max(0, Math.min(100, update.percent))}%` }} />
              </div>
            ) : null}
            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={busy}>关闭</Button>
              {action ? (
                <Button className="primary-button" onPress={() => void runAction()} isDisabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : action === "download" ? <Download size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                  {updateActionLabel(update, pending)}
                </Button>
              ) : null}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function UpdateSummary({ update, pending }: { update: UpdateState; pending: boolean }) {
  const loading = pending || update.phase === "checking" || update.phase === "downloading";
  const Icon = loading
    ? LoaderCircle
    : update.phase === "error"
      ? TriangleAlert
      : update.phase === "current" || update.phase === "downloaded"
        ? CircleCheck
        : update.phase === "available"
          ? Download
          : RefreshCw;
  return (
    <div className={`update-summary phase-${update.phase}`} role="status">
      <Icon className={loading ? "spin" : undefined} size={18} aria-hidden="true" />
      <div><strong>{updateTitle(update, pending)}</strong><span>{updateDetail(update)}</span></div>
    </div>
  );
}

function updateTitle(update: UpdateState, pending: boolean): string {
  if (pending || update.phase === "checking") return "正在检查更新";
  if (update.phase === "available") return `发现 Pi-67 Desktop ${update.version}`;
  if (update.phase === "downloading") return `正在下载更新 · ${Math.round(update.percent)}%`;
  if (update.phase === "downloaded") return `Pi-67 Desktop ${update.version} 已就绪`;
  if (update.phase === "current") return "当前已是最新版本";
  if (update.phase === "disabled") return "开发构建不检查更新";
  if (update.phase === "error") return "更新操作未完成";
  return "由你决定何时联网检查";
}

function updateDetail(update: UpdateState): string {
  if (update.phase === "available") return "确认后才会下载更新文件。";
  if (update.phase === "downloaded") return "安装会退出应用，请先确认当前任务已保存。";
  if (update.phase === "error") return update.detail;
  if (update.phase === "disabled") return "打包并签名后的版本才会启用更新服务。";
  return "不会自动下载或自动安装。";
}

function updateAction(update: UpdateState): "check" | "download" | "install" | undefined {
  if (update.phase === "available") return "download";
  if (update.phase === "downloaded") return "install";
  if (update.phase === "checking" || update.phase === "downloading" || update.phase === "disabled") return undefined;
  return "check";
}

function updateActionLabel(update: UpdateState, pending: boolean): string {
  if (pending || update.phase === "checking") return "正在检查…";
  if (update.phase === "available") return `下载 ${update.version}`;
  if (update.phase === "downloading") return `正在下载 ${Math.round(update.percent)}%`;
  if (update.phase === "downloaded") return "退出并安装更新";
  return update.phase === "error" ? "重新检查更新" : "检查更新";
}

function parseUpdateState(value: unknown): UpdateState {
  if (typeof value !== "object" || value === null || !("phase" in value) || typeof value.phase !== "string") return idleState;
  if (value.phase === "idle" || value.phase === "checking" || value.phase === "current" || value.phase === "disabled") return { phase: value.phase };
  if ((value.phase === "available" || value.phase === "downloaded") && "version" in value && typeof value.version === "string") {
    return { phase: value.phase, version: value.version };
  }
  if (value.phase === "downloading" && "percent" in value && typeof value.percent === "number" && Number.isFinite(value.percent)) {
    return { phase: "downloading", percent: value.percent };
  }
  if (value.phase === "error" && "detail" in value && typeof value.detail === "string") return { phase: "error", detail: value.detail.slice(0, 500) };
  return { phase: "error", detail: "更新服务返回了无法识别的状态；没有执行下载或安装。" };
}
