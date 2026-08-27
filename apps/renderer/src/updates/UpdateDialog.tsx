import { CircleCheck, Download, LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useShellStore } from "../shell/shell-store.js";
import type { UpdateState } from "./update-state.js";
import {
  cancelUpdateNow,
  checkForUpdatesNow,
  startUpdateNow,
  useUpdateStore
} from "./update-store.js";

type UpdateAction = "check" | "install";

export function UpdateDialog() {
  const open = useShellStore((state) => state.updateDialogOpen);
  const setOpen = useShellStore((state) => state.setUpdateDialogOpen);
  const update = useUpdateStore((state) => state.update);
  const initialized = useUpdateStore((state) => state.initialized);
  const [pendingAction, setPendingAction] = useState<UpdateAction>();
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (!open) return null;
  const action = initialized ? updateAction(update) : undefined;
  const pending = pendingAction !== undefined;
  const operationActive = pending || cancelling || update.phase === "downloading" || update.phase === "installing";

  const runAction = async () => {
    if (!initialized || !action || pending || cancelling) return;
    setPendingAction(action);
    setActionError(undefined);
    try {
      if (action === "check") await checkForUpdatesNow();
      else await startUpdateNow();
    } catch {
      setActionError(action === "check"
        ? "更新检查失败。当前版本和 Pi 会话保持不变，请稍后重试。"
        : "更新没有启动。当前版本和 Pi 会话保持不变，可以重新检查后再试。");
    } finally {
      setPendingAction(undefined);
    }
  };

  const cancelDownload = async () => {
    if (update.phase !== "downloading" || cancelling) return;
    setCancelling(true);
    setActionError(undefined);
    try {
      await cancelUpdateNow();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <ModalOverlay
      className="modal-overlay"
      isOpen
      isDismissable={!operationActive}
      onOpenChange={setOpen}
    >
      <Modal className="modal-surface update-dialog">
        <Dialog aria-label="Pi-67 更新">
          <div className="diagnostic-dialog-content">
            <span className="dialog-eyebrow">Internal Unsigned Update</span>
            <Heading slot="title">Pi-67 更新</Heading>
            <UpdateSummary update={update} initialized={initialized} pending={pending} action={action} />
            {update.phase === "downloading" ? (
              <div
                className="update-progress-track"
                role="progressbar"
                aria-label="更新下载进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(update.percent)}
              >
                <span style={{ width: `${update.percent}%` }} />
              </div>
            ) : null}
            <div className="update-network-note">
              更新只连接 updates.52671314.xyz，不发送工作区、会话、模型服务或密钥信息。安装包下载完成后会核对大小和 SHA-256，再退出并启动内部未签名更新。
            </div>
            {actionError ? <div className="update-action-error" role="alert">{actionError}</div> : null}
            <div className="dialog-actions">
              {update.phase === "downloading" ? (
                <Button className="secondary-button" onPress={() => void cancelDownload()} isDisabled={cancelling}>
                  <X size={14} aria-hidden="true" />
                  {cancelling ? "正在取消…" : "取消下载"}
                </Button>
              ) : (
                <Button
                  className="secondary-button"
                  onPress={() => setOpen(false)}
                  isDisabled={operationActive}
                >
                  {update.phase === "available" ? "稍后处理" : "关闭"}
                </Button>
              )}
              {action ? (
                <Button className="primary-button" onPress={() => void runAction()} isDisabled={pending || cancelling}>
                  {pending
                    ? <LoaderCircle className="spin" size={14} aria-hidden="true" />
                    : action === "install"
                      ? <Download size={14} aria-hidden="true" />
                      : <RefreshCw size={14} aria-hidden="true" />}
                  {updateActionLabel(action, pending)}
                </Button>
              ) : null}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function UpdateSummary({ update, initialized, pending, action }: {
  update: UpdateState;
  initialized: boolean;
  pending: boolean;
  action: UpdateAction | undefined;
}) {
  const Icon = !initialized || pending || update.phase === "checking" || update.phase === "installing"
    ? LoaderCircle
    : update.phase === "error"
      ? TriangleAlert
      : update.phase === "current"
        ? CircleCheck
        : update.phase === "available" || update.phase === "downloading"
          ? Download
          : RefreshCw;
  return (
    <div className={`update-summary phase-${update.phase}`} role="status">
      <Icon
        className={!initialized || pending || update.phase === "checking" || update.phase === "installing"
          ? "spin"
          : undefined}
        size={18}
        aria-hidden="true"
      />
      <div>
        <strong>{updateTitle(update, initialized, pending, action)}</strong>
        <span>{updateDetail(update, initialized)}</span>
      </div>
    </div>
  );
}

function updateTitle(
  update: UpdateState,
  initialized: boolean,
  pending: boolean,
  action?: UpdateAction
): string {
  if (!initialized) return "正在读取更新状态";
  if (pending && action === "check") return "正在检查更新";
  if (update.phase === "checking") return "正在检查更新";
  if (update.phase === "downloading") return `正在下载 Pi-67 ${update.version}`;
  if (update.phase === "installing") return `正在安装 Pi-67 ${update.version}`;
  if (update.phase === "available") return `发现 Pi-67 ${update.version}`;
  if (update.phase === "current") return "当前已是最新版本";
  if (update.phase === "disabled") return "开发构建不检查更新";
  if (update.phase === "error") return "更新操作未完成";
  return update.automaticChecks ? "正在等待自动检查" : "尚未检查更新";
}

export function updateDetail(update: UpdateState, initialized: boolean): string {
  if (!initialized) return "正在确认当前版本和自动检查设置。";
  if (update.phase === "available") {
    return `安装包 ${formatBytes(update.artifactBytes)}。点击后会自动下载、校验，并启动内部更新安装。`;
  }
  if (update.phase === "downloading") {
    return `${formatBytes(update.transferred)} / ${formatBytes(update.artifactBytes)}（${Math.round(update.percent)}%）`;
  }
  if (update.phase === "installing") {
    return update.artifactName.endsWith(".exe")
      ? "安装包已通过 SHA-256 校验；应用将退出，Windows 会继续显示独立安装进度，完成后自动重新打开。"
      : "安装包已通过 SHA-256 校验；应用即将退出、替换并重新启动。";
  }
  if (update.phase === "current") {
    return `当前版本 ${update.currentVersion}；自动检查已开启，但不会在未点击时下载或安装。`;
  }
  if (update.phase === "error") return update.detail;
  if (update.phase === "disabled") return "开发构建不会请求更新；打包预览版才启用内部更新。";
  if (update.phase === "checking") return "正在读取固定 R2 更新清单，不会自动下载安装包。";
  return `当前版本 ${update.currentVersion}；打包版启动后会自动检查，但下载和安装需要点击确认。`;
}

function updateAction(update: UpdateState): UpdateAction | undefined {
  if (update.phase === "available") return "install";
  if (
    update.phase === "disabled"
    || update.phase === "checking"
    || update.phase === "downloading"
    || update.phase === "installing"
  ) return undefined;
  return "check";
}

function updateActionLabel(action: UpdateAction, pending: boolean): string {
  if (pending) return action === "install" ? "正在启动…" : "正在检查…";
  return action === "install" ? "下载并安装" : "检查更新";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
