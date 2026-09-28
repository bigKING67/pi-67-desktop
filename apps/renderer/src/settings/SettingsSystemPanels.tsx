import { MAX_RUNNING_TASKS, taskConsumesRunSlot } from "@pi67/domain";
import { useCallback, useEffect, useState } from "react";
import { Button } from "react-aria-components";
import piIconUrl from "../assets/pi-icon-64.png";
import { useShellStore } from "../shell/shell-store.js";
import styles from "./SettingsSystemPanels.module.css";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  SettingsDetails,
  SettingsInfo,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";

type PlatformInfo = Awaited<ReturnType<Window["pi67"]["system"]["getPlatformInfo"]>>;

export function RuntimeSettings() {
  const setDoctorDialogOpen = useShellStore((state) => state.setDoctorDialogOpen);
  const tasks = useWorkbenchStore((state) => state.tasks);
  const runningCount = Object.values(tasks).filter((task) => taskConsumesRunSlot(task.lifecycle)).length;
  return (
    <SettingsSectionBlock title="Pi 运行服务">
      <SettingsRows>
        <SettingsRow
          title={<>正在占用运行名额<SettingsInfo label="运行名额说明">每个活动任务拥有独立的 Pi 运行服务，切换工作区或会话不会停止后台任务。</SettingsInfo></>}
          description="执行中、等待审批或交互的任务会占用名额；任务内部的子代理不单独占用"
          value={`${runningCount} / ${MAX_RUNNING_TASKS}`}
        />
        <SettingsRow
          title="恢复与诊断"
          description="运行异常时从这里检查环境、工作区与会话恢复"
          actions={<Button aria-label="恢复与诊断" className="secondary-button" onPress={() => setDoctorDialogOpen(true)}>打开诊断</Button>}
        />
      </SettingsRows>
      <SettingsDetails title="运行机制" summary="会话与写入规则">
        <SettingsRows>
        <SettingsRow title="可浏览的本地会话" description="会话目录按需加载，Pi JSONL 始终是唯一真源。" value="不设上限" />
        <SettingsRow title="单个会话写入实例" description="同一 Session 路径不会同时绑定两个 live writer。" value="1 个" />
        </SettingsRows>
      </SettingsDetails>
    </SettingsSectionBlock>
  );
}

export function AboutSettings() {
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setPlatformInfo(await window.pi67.system.getPlatformInfo());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取当前应用信息");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className={styles.about}>
      <header className={styles.aboutIdentity}>
        <img alt="" aria-hidden="true" src={piIconUrl} />
        <span>
          <h2>New Money</h2>
          <p>用 AI 创造新的价值。</p>
        </span>
      </header>
      {error ? <SettingsNotice
        tone="danger"
        actions={<Button className="secondary-button" isDisabled={loading} onPress={() => void load()}>重试</Button>}
      >无法读取当前应用信息：{error}</SettingsNotice> : null}
      <SettingsRows>
        <SettingsRow title="当前版本" value={loading ? "正在读取…" : platformInfo?.version ?? "未知"} />
        <SettingsRow title="操作系统" value={platformLabel(platformInfo?.platform)} />
        <SettingsRow title="处理器架构" value={architectureLabel(platformInfo?.architecture)} />
        <SettingsRow title="发布与更新" value="Internal Unsigned · 点击更新" />
      </SettingsRows>
      <SettingsDetails title="技术信息" summary="运行组件、会话格式与安全边界">
        <SettingsRows>
        <SettingsRow title="Agent 运行组件" value="@earendil-works/pi-coding-agent" />
        <SettingsRow title="会话真源" value="Pi JSONL" />
        <SettingsRow title="渲染进程" value="Electron sandbox + contextIsolation" />
        <SettingsRow title="网络边界" value="生产环境无本地 HTTP 服务或业务网络监听" />
        </SettingsRows>
      </SettingsDetails>
    </div>
  );
}

function platformLabel(platform: PlatformInfo["platform"] | undefined): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  return "未知";
}

function architectureLabel(architecture: PlatformInfo["architecture"] | undefined): string {
  if (architecture === "arm64") return "Apple Silicon (arm64)";
  if (architecture === "x64") return "x64";
  return "未知";
}
