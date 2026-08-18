import type {
  DesktopCapabilitySnapshot,
  DesktopIntegrationStatus
} from "@pi67/domain";
import { Download, Puzzle, RefreshCw, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import styles from "./DesktopCapabilityPanels.module.css";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import { Browser67ExtensionInstallDialog } from "./Browser67ExtensionInstallDialog.js";

export function Browser67IntegrationPanel() {
  const { snapshot, setSnapshot, phase, error, setError, refresh } = useDesktopCapabilitySnapshot();
  const [operation, setOperation] = useState<"prepare" | "doctor" | "verify">();
  const [installerOpen, setInstallerOpen] = useState(false);
  const integration = snapshot?.integrations.find((entry) => entry.id === "browser67");
  const execute = useCallback(async (kind: "prepare" | "doctor" | "verify") => {
    setOperation(kind);
    setError(undefined);
    try {
      setSnapshot(kind === "prepare"
        ? await window.pi67.system.prepareBrowser67Extension()
        : kind === "verify"
          ? await window.pi67.system.verifyBrowser67Extension({ startHub: true })
          : await window.pi67.system.doctorBrowser67());
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "browser67 操作失败");
    } finally {
      setOperation(undefined);
    }
  }, [setError, setSnapshot]);
  return (
    <>
    <SettingsSectionBlock
      actions={<Button className="secondary-button" isDisabled={phase === "loading" || operation !== undefined} onPress={() => void refresh()}>
        <RefreshCw aria-hidden="true" size={14} />刷新
      </Button>}
      description="内置表示源码与技能随应用提供，不代表浏览器扩展、依赖或真实受管浏览器已经就绪。"
      title="browser67"
    >
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
      <SettingsRows>
        <SettingsRow leading={<span className={styles.status} data-status="ready" />} title="源码" description="固定第一方快照随 Desktop 提供。" value="内置第一方" />
        <SettingsRow
          leading={<span className={styles.status} data-status={integration?.dependencyState === "prepared" ? "ready" : integration?.dependencyState === "failed" ? "failed" : "warning"} />}
          title="运行依赖"
          description="依赖准备与随应用提供的源码是两个独立状态。"
          value={dependencyLabel(integration)}
        />
        <SettingsRow
          leading={<span className={styles.status} data-status={extensionTone(integration)} />}
          title="浏览器扩展"
          description="扩展文件已准备不等于已经在 Chrome/Edge 中加载。"
          value={extensionLabel(integration)}
        />
        <SettingsRow
          leading={<span className={styles.status} data-status={integration?.doctorState === "ready" ? "ready" : integration?.doctorState === "failed" ? "failed" : "warning"} />}
          title="受管连接"
          description={integration?.detail ?? "尚未证明真实受管浏览器连接已经就绪。"}
          value={doctorLabel(integration)}
        />
        <SettingsRow
          title="安装与连接"
          description="安装会准备 unpacked extension；首次加载需要你在浏览器扩展页确认。"
          actions={<>
            <Button className="primary-button" isDisabled={operation !== undefined} onPress={() => setInstallerOpen(true)}>
              {integration?.extensionState === "connected"
                ? <Puzzle aria-hidden="true" size={14} />
                : <Download aria-hidden="true" size={14} />}
              {installActionLabel(integration)}
            </Button>
            <Button className="secondary-button" isDisabled={operation !== undefined} onPress={() => void execute("doctor")}>
              <Stethoscope aria-hidden="true" size={14} />{operation === "doctor" ? "检查中…" : "运行诊断"}
            </Button>
          </>}
        />
      </SettingsRows>
    </SettingsSectionBlock>
    <Browser67ExtensionInstallDialog
      error={error}
      integration={integration}
      open={installerOpen}
      operation={operation}
      onClose={() => setInstallerOpen(false)}
      onPrepare={() => execute("prepare")}
      onVerify={() => execute("verify")}
    />
    </>
  );
}

export function useDesktopCapabilitySnapshot() {
  const [snapshot, setSnapshot] = useState<DesktopCapabilitySnapshot>();
  const [phase, setPhase] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string>();
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    setPhase("loading");
    setError(undefined);
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const next = await window.pi67.system.getDesktopCapabilitySnapshot();
        if (!mounted.current) return;
        setSnapshot(next);
        if (next.phase !== "initializing") return;
        await delay(250);
      }
    } catch (loadError) {
      if (mounted.current) {
        setError(loadError instanceof Error ? loadError.message : "无法读取内置能力状态");
      }
    } finally {
      if (mounted.current) setPhase("idle");
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);
  return { snapshot, setSnapshot, phase, error, setError, refresh };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function doctorLabel(integration: DesktopIntegrationStatus | undefined): string {
  if (!integration || integration.doctorState === "not-checked") return "尚未检查";
  if (integration.doctorState === "degraded") return "部分可用";
  if (integration.doctorState === "ready") return "就绪";
  return "失败";
}

function dependencyLabel(integration: DesktopIntegrationStatus | undefined): string {
  if (!integration) return "检查中";
  if (integration.dependencyState === "prepared") return "已准备";
  if (integration.dependencyState === "not-prepared") return "未准备";
  return "失败";
}

function extensionLabel(integration: DesktopIntegrationStatus | undefined): string {
  if (!integration) return "检查中";
  if (integration.extensionState === "prepared") return "待浏览器加载";
  if (integration.extensionState === "reload-required") return "需要同步受管版本";
  if (integration.extensionState === "connected") return "已安装并连接";
  if (integration.extensionState === "failed") return "失败";
  return "未安装";
}

function extensionTone(integration: DesktopIntegrationStatus | undefined): "ready" | "failed" | "warning" {
  if (integration?.extensionState === "connected") return "ready";
  if (integration?.extensionState === "failed") return "failed";
  return "warning";
}

function installActionLabel(integration: DesktopIntegrationStatus | undefined): string {
  if (integration?.extensionState === "connected") return "查看扩展连接";
  if (integration?.extensionState === "prepared") return "继续安装";
  if (integration?.extensionState === "reload-required") return "修复浏览器扩展";
  return "安装浏览器扩展";
}
