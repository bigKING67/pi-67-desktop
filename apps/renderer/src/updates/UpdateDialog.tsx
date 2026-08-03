import { CircleCheck, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useShellStore } from "../shell/shell-store.js";
import type { UpdateState } from "./update-state.js";
import { checkForUpdatesNow, useUpdateStore } from "./update-store.js";

type UpdateAction = "check" | "open";

export function UpdateDialog() {
  const open = useShellStore((state) => state.updateDialogOpen);
  const setOpen = useShellStore((state) => state.setUpdateDialogOpen);
  const update = useUpdateStore((state) => state.update);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (!open) return null;
  const action = updateAction(update);

  const runAction = async () => {
    if (!action || pending) return;
    setPending(true);
    setActionError(undefined);
    try {
      if (action === "check") {
        await checkForUpdatesNow();
      } else if (update.phase === "available") {
        const opened = await window.pi67.system.requestOpenExternal(update.releaseUrl);
        if (!opened) setActionError("GitHub 更新页未打开；当前版本和 Pi 会话均未改变，可以再次尝试。");
      }
    } catch {
      setActionError(action === "check"
        ? "更新检查失败。当前版本和 Pi 会话保持不变，请稍后重试。"
        : "无法打开 GitHub 更新页；当前版本和 Pi 会话均未改变，可以再次尝试。");
    } finally {
      setPending(false);
    }
  };

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!pending} onOpenChange={setOpen}>
      <Modal className="modal-surface update-dialog">
        <Dialog aria-label="Pi-67 更新">
          <div className="diagnostic-dialog-content">
            <span className="dialog-eyebrow">Unsigned Preview</span>
            <Heading slot="title">Pi-67 更新</Heading>
            <UpdateSummary update={update} pending={pending} action={action} />
            <div className="update-network-note">
              自动检查只请求 Pi-67 的公开 GitHub Release 元数据，不会发送工作区、会话、模型服务或密钥信息，也不会自动下载或安装。
            </div>
            {actionError ? <div className="update-action-error" role="alert">{actionError}</div> : null}
            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={pending}>
                {update.phase === "available" ? "稍后处理" : "关闭"}
              </Button>
              {action ? (
                <Button className="primary-button" onPress={() => void runAction()} isDisabled={pending}>
                  {pending
                    ? <LoaderCircle className="spin" size={14} aria-hidden="true" />
                    : action === "open"
                      ? <ExternalLink size={14} aria-hidden="true" />
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

function UpdateSummary({ update, pending, action }: {
  update: UpdateState;
  pending: boolean;
  action: UpdateAction | undefined;
}) {
  const Icon = pending
    ? LoaderCircle
    : update.phase === "error"
      ? TriangleAlert
      : update.phase === "current"
        ? CircleCheck
        : update.phase === "available"
          ? ExternalLink
          : RefreshCw;
  return (
    <div className={`update-summary phase-${update.phase}`} role="status">
      <Icon className={pending ? "spin" : undefined} size={18} aria-hidden="true" />
      <div><strong>{updateTitle(update, pending, action)}</strong><span>{updateDetail(update)}</span></div>
    </div>
  );
}

function updateTitle(update: UpdateState, pending: boolean, action?: UpdateAction): string {
  if (pending) return action === "open" ? "正在打开 GitHub 更新页" : "正在检查更新";
  if (update.phase === "available") return `发现 Pi-67 ${update.version}`;
  if (update.phase === "current") return "当前已是最新版本";
  if (update.phase === "disabled") return "开发构建不检查更新";
  if (update.phase === "error") return "更新检查未完成";
  return update.automaticChecks ? "正在等待自动检查" : "尚未检查更新";
}

function updateDetail(update: UpdateState): string {
  if (update.phase === "available") {
    const published = update.publishedAt ? `发布于 ${update.publishedAt.slice(0, 10)}。` : "";
    return `Unsigned Preview 不会自动下载或安装。${published}查看 GitHub Release，核对 SHA-256 后手动下载安装。`;
  }
  if (update.phase === "current") {
    return `当前版本 ${update.currentVersion}；自动检查已开启，不会自动下载或安装。`;
  }
  if (update.phase === "error") return update.detail;
  if (update.phase === "disabled") return "开发构建不会请求 GitHub Release；打包预览版会自动检查更新。";
  return `当前版本 ${update.currentVersion}；打包版启动后会自动检查，但不会自动下载或安装。`;
}

function updateAction(update: UpdateState): UpdateAction | undefined {
  if (update.phase === "available") return "open";
  if (update.phase === "disabled") return undefined;
  return "check";
}

function updateActionLabel(action: UpdateAction, pending: boolean): string {
  if (pending) return action === "open" ? "正在打开…" : "正在检查…";
  return action === "open" ? "查看更新" : "检查更新";
}
