import type { SessionCompatibilityView } from "@pi67/domain";
import { AlertTriangle, RefreshCw, Stethoscope } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useShellStore } from "../shell/shell-store.js";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
import styles from "./Transcript.module.css";

export function SessionCompatibilityBanner() {
  const compatibility = useSessionProjectionStore((state) => state.compatibility);
  const task = useWorkbenchStore(selectedWorkbenchTask);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const [refreshing, setRefreshing] = useState(false);
  const copy = compatibility ? sessionCompatibilityBannerCopy(compatibility) : undefined;
  if (!compatibility || !copy) return null;

  const refresh = async () => {
    if (!task || hostEpoch === undefined || refreshing) return;
    setRefreshing(true);
    try {
      await resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
        hostEpoch,
        ...(task.operationId === undefined ? {} : { operationId: task.operationId }),
        context: workbenchProtocolContextForTask(task),
        recoveringDetail: "正在重新读取当前 Pi 会话",
        readyDetail: "Pi 会话已重新同步",
        failureTitle: "无法重新同步 Pi 会话"
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className={styles.compatibilityBanner} role="status">
      <AlertTriangle aria-hidden="true" size={16} />
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.detail}</p>
      </div>
      <div className={styles.compatibilityActions}>
        <button disabled={!task || refreshing} type="button" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" className={refreshing ? styles.spin : undefined} size={13} />
          {refreshing ? "正在同步" : "重新同步"}
        </button>
        <button type="button" onClick={() => useShellStore.getState().setDoctorDialogOpen(true)}>
          <Stethoscope aria-hidden="true" size={13} />查看诊断
        </button>
      </div>
    </div>
  );
}

export function sessionCompatibilityBannerCopy(
  compatibility: SessionCompatibilityView
): { title: string; detail: string } | undefined {
  if (compatibility.status === "compatible") return undefined;
  const counts = [
    compatibility.unknownEntryCount > 0 ? `${compatibility.unknownEntryCount} 条未知事件` : undefined,
    compatibility.unrenderableMessageCount > 0
      ? `${compatibility.unrenderableMessageCount} 条消息无法完整显示`
      : undefined
  ].filter(Boolean).join("，");
  return {
    title: compatibility.status === "future-format"
      ? "此对话使用了较新的 Pi 会话格式"
      : "此对话包含当前版本无法完整识别的内容",
    detail: `已知消息仍可查看，部分事件可能暂未显示。格式版本 ${compatibility.sessionFormatVersion}，`
      + `当前支持到 ${compatibility.currentSupportedVersion}${counts ? `；${counts}` : ""}。`
  };
}
