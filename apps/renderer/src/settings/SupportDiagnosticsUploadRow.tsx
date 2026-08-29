import type { SupportDiagnosticsUploadReceipt } from "@pi67/protocol";
import { Check, CloudUpload, Copy, FileDown } from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import { useCopyFeedback } from "../clipboard/use-copy-feedback.js";
import {
  saveRuntimeDiagnostics,
  uploadRuntimeDiagnostics
} from "../doctor/runtime-diagnostics-controller.js";
import { SettingsRow } from "./SettingsPrimitives.js";
import styles from "./SupportDiagnosticsUploadRow.module.css";

type DiagnosticsUploadState =
  | { phase: "idle" }
  | { phase: "uploading" }
  | { phase: "success"; receipt: SupportDiagnosticsUploadReceipt }
  | { phase: "error"; message: string };

export function SupportDiagnosticsUploadRow() {
  const [state, setState] = useState<DiagnosticsUploadState>({ phase: "idle" });
  const { copyState, copyText } = useCopyFeedback({ failureTitle: "无法复制报告编号" });
  const upload = async (): Promise<void> => {
    if (state.phase === "uploading") return;
    setState({ phase: "uploading" });
    try {
      const receipt = await uploadRuntimeDiagnostics();
      setState({ phase: "success", receipt });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "诊断上传未完成，请重试或导出到本地。"
      });
    }
  };

  const description = state.phase === "success"
    ? "上传完成。反馈问题时请附上报告编号；服务端诊断将在 30 天后自动删除。"
    : state.phase === "error"
      ? <span className={styles.error}>上传未完成：{state.message}</span>
      : state.phase === "uploading"
        ? "正在收集 Main、Agent Host 与恢复状态并上传，请勿关闭应用。"
        : "仅在你点击后上传；不包含提示词、源码正文、凭据或原始工具载荷。上传失败时仍可导出到本地。";
  const value = state.phase === "success"
    ? <span className={styles.receipt}><Check aria-hidden="true" size={14} />{state.receipt.reportId}</span>
    : state.phase === "uploading"
      ? "正在上传…"
      : state.phase === "error"
        ? "未上传"
        : "仅手动";

  return <SettingsRow
    leading={<CloudUpload aria-hidden="true" size={17} />}
    title="上传脱敏诊断"
    description={description}
    value={<span aria-live={state.phase === "error" ? "assertive" : "polite"} role="status">{value}</span>}
    actions={actions(state, copyState, copyText, upload)}
  />;
}

function actions(
  state: DiagnosticsUploadState,
  copyState: "idle" | "copied" | "failed",
  copyText: (text: string) => Promise<boolean>,
  upload: () => Promise<void>
) {
  if (state.phase === "success") return <>
    <Button
      aria-label={`复制报告编号 ${state.receipt.reportId}`}
      className="secondary-button"
      onPress={() => void copyText(state.receipt.reportId)}
    >
      <Copy aria-hidden="true" size={14} />
      {copyState === "copied" ? "已复制" : "复制编号"}
    </Button>
    <Button className="secondary-button" onPress={() => void upload()}>再次上传</Button>
  </>;
  if (state.phase === "error") return <>
    <Button className="secondary-button" onPress={() => void saveRuntimeDiagnostics()}>
      <FileDown aria-hidden="true" size={14} />
      导出到本地
    </Button>
    <Button className="primary-button" onPress={() => void upload()}>重试上传</Button>
  </>;
  return <Button
    aria-label="上传脱敏诊断"
    className="primary-button"
    isDisabled={state.phase === "uploading"}
    onPress={() => void upload()}
  >
    <CloudUpload aria-hidden="true" size={14} />
    {state.phase === "uploading" ? "上传中…" : "上传"}
  </Button>;
}
