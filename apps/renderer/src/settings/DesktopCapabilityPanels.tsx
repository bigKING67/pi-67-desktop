import type {
  DesktopCapabilitySnapshot,
  DesktopIntegrationStatus
} from "@pi67/domain";
import { Download, RefreshCw, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import styles from "./DesktopCapabilityPanels.module.css";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";

export function Browser67IntegrationPanel() {
  const { snapshot, setSnapshot, phase, error, setError, refresh } = useDesktopCapabilitySnapshot();
  const [operation, setOperation] = useState<"setup" | "doctor">();
  const integration = snapshot?.integrations.find((entry) => entry.id === "browser67");
  const execute = async (kind: "setup" | "doctor") => {
    setOperation(kind);
    setError(undefined);
    try {
      setSnapshot(kind === "setup"
        ? await window.pi67.system.setupBrowser67()
        : await window.pi67.system.doctorBrowser67());
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "browser67 操作失败");
    } finally {
      setOperation(undefined);
    }
  };
  return (
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
          title="依赖"
          description="依赖准备与随应用提供的源码是两个独立状态。"
          value={dependencyLabel(integration)}
        />
        <SettingsRow
          leading={<span className={styles.status} data-status={integration?.doctorState === "ready" ? "ready" : integration?.doctorState === "failed" ? "failed" : "warning"} />}
          title="诊断"
          description={integration?.detail ?? "尚未证明真实受管浏览器连接已经就绪。"}
          value={doctorLabel(integration)}
        />
        <SettingsRow
          title="准备与诊断"
          description="准备依赖可能访问网络；诊断不会把 bundled 状态误报为真实连接就绪。"
          actions={<>
            <Button className="primary-button" isDisabled={operation !== undefined} onPress={() => void execute("setup")}>
              <Download aria-hidden="true" size={14} />{operation === "setup" ? "准备中…" : "准备依赖"}
            </Button>
            <Button className="secondary-button" isDisabled={operation !== undefined} onPress={() => void execute("doctor")}>
              <Stethoscope aria-hidden="true" size={14} />{operation === "doctor" ? "检查中…" : "运行诊断"}
            </Button>
          </>}
        />
      </SettingsRows>
    </SettingsSectionBlock>
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
