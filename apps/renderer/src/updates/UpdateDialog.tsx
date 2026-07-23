import { CircleCheck, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";

const channel = "unsigned-preview" as const;
const releasePageBaseUrl = "https://github.com/bigKING67/pi-67-desktop/releases/tag/";

type UpdateState =
  | { phase: "idle" | "current"; channel: typeof channel; currentVersion: string }
  | {
      phase: "available";
      channel: typeof channel;
      currentVersion: string;
      version: string;
      releaseUrl: string;
      publishedAt?: string;
    }
  | { phase: "disabled" | "error"; channel: typeof channel; currentVersion: string; detail: string };

type UpdateAction = "check" | "open";

const idleState: UpdateState = { phase: "idle", channel, currentVersion: "unknown" };

export function UpdateDialog() {
  const open = useAppStore((state) => state.updateDialogOpen);
  const setOpen = useAppStore((state) => state.setUpdateDialogOpen);
  const [update, setUpdate] = useState<UpdateState>(idleState);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPending(false);
    setActionError(undefined);
    void window.pi67.system.getUpdateState().then((value) => {
      if (active) setUpdate(parseUpdateState(value));
    }).catch(() => {
      if (active) setUpdate(errorState("无法读取更新服务状态；没有执行网络请求。"));
    });
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;
  const action = updateAction(update);

  const runAction = async () => {
    if (!action || pending) return;
    setPending(true);
    setActionError(undefined);
    try {
      if (action === "check") {
        setUpdate(parseUpdateState(await window.pi67.system.checkForUpdates()));
      } else if (update.phase === "available") {
        const opened = await window.pi67.system.requestOpenExternal(update.releaseUrl);
        if (!opened) setActionError("GitHub 下载页未打开；当前版本和 Pi 会话均未改变，可以再次尝试。");
      }
    } catch {
      if (action === "check") {
        setUpdate(errorState("更新检查失败。当前版本和 Pi 会话保持不变，请稍后重试。", update.currentVersion));
      } else {
        setActionError("无法打开 GitHub 下载页；当前版本和 Pi 会话均未改变，可以再次尝试。");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!pending} onOpenChange={setOpen}>
      <Modal className="modal-surface update-dialog">
        <Dialog aria-label="Unsigned Preview 手动更新">
          <div className="diagnostic-dialog-content">
            <span className="dialog-eyebrow">Unsigned preview</span>
            <Heading slot="title">Unsigned Preview 手动更新</Heading>
            <UpdateSummary update={update} pending={pending} action={action} />
            <div className="update-network-note">
              检查更新只会请求 Pi-67 Desktop 的公开 GitHub Release 元数据，不会发送工作区、会话、模型、Provider 或凭据数据。
            </div>
            {actionError ? <div className="update-action-error" role="alert">{actionError}</div> : null}
            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={pending}>关闭</Button>
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
  if (pending) return action === "open" ? "正在打开 GitHub 下载页" : "正在检查更新";
  if (update.phase === "available") return `发现 Pi-67 Desktop ${update.version}`;
  if (update.phase === "current") return "未发现可用新版本";
  if (update.phase === "disabled") return "开发构建不检查更新";
  if (update.phase === "error") return "更新检查未完成";
  return "由你决定何时联网检查";
}

function updateDetail(update: UpdateState): string {
  if (update.phase === "available") {
    const published = update.publishedAt ? `发布于 ${update.publishedAt.slice(0, 10)}。` : "";
    return `Unsigned Preview 不会自动下载或安装。${published}打开 GitHub Release，核对 SHA-256 后手动下载安装。`;
  }
  if (update.phase === "current") return `当前版本 ${update.currentVersion}；不会自动下载或安装。`;
  if (update.phase === "error") return update.detail;
  if (update.phase === "disabled") return "开发构建不会请求 GitHub Release；打包预览版使用手动更新。";
  return `当前版本 ${update.currentVersion}；不会自动检查、下载或安装。`;
}

function updateAction(update: UpdateState): UpdateAction | undefined {
  if (update.phase === "available") return "open";
  if (update.phase === "disabled") return undefined;
  return "check";
}

function updateActionLabel(action: UpdateAction, pending: boolean): string {
  if (pending) return action === "open" ? "正在打开…" : "正在检查…";
  return action === "open" ? "打开 GitHub 下载页" : "检查更新";
}

function parseUpdateState(value: unknown): UpdateState {
  if (!isRecord(value) || value.channel !== channel || !isBoundedString(value.currentVersion, 100)) {
    return errorState("更新服务返回了无法识别的状态；没有执行下载或安装。");
  }
  const currentVersion = value.currentVersion;
  if (value.phase === "idle" || value.phase === "current") return { phase: value.phase, channel, currentVersion };
  if (value.phase === "available" && isBoundedString(value.version, 100)) {
    const releaseUrl = `${releasePageBaseUrl}v${value.version}`;
    if (value.releaseUrl !== releaseUrl) return errorState("更新服务返回了无效的下载地址；没有打开外部页面。", currentVersion);
    const publishedAt = typeof value.publishedAt === "string" && !Number.isNaN(Date.parse(value.publishedAt))
      ? new Date(value.publishedAt).toISOString()
      : undefined;
    return {
      phase: "available",
      channel,
      currentVersion,
      version: value.version,
      releaseUrl,
      ...(publishedAt ? { publishedAt } : {})
    };
  }
  if ((value.phase === "disabled" || value.phase === "error") && isBoundedString(value.detail, 500)) {
    return { phase: value.phase, channel, currentVersion, detail: value.detail };
  }
  return errorState("更新服务返回了无法识别的状态；没有执行下载或安装。", currentVersion);
}

function errorState(detail: string, currentVersion = "unknown"): UpdateState {
  return { phase: "error", channel, currentVersion, detail: detail.slice(0, 500) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}
