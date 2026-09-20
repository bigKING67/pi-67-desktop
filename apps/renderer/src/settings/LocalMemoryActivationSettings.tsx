import type { LocalMemoryActivationSnapshot, LocalMemoryHealthCheck } from "@pi67/protocol";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { SettingsNotice, SettingsRow, SettingsRows, SettingsSectionBlock } from "./SettingsPrimitives.js";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";

type Available = Extract<LocalMemoryActivationSnapshot, { available: true }>;
const states: Record<Available["lifecycle"], string> = {
  idle: "尚未启动", starting: "正在启动并校验运行包…", running: "本地服务运行中",
  failed: "启动失败或服务已退出", blocked: "连续失败，已停止重试", stopping: "正在停止并清理…",
  stopped: "本次运行已停止", "stop-failed": "停止未完成"
};
const issues: Record<Available["issue"], string | undefined> = {
  none: undefined,
  storage: "启用偏好未确认保存。本次关闭会阻止新连接，但下次启动的偏好尚未确认；请重试关闭或检查本地存储。",
  "runtime-missing": "请先安装私人记忆运行包，再启用。团队运行包不能代替私人运行包。",
  "models-missing": "请先保存完整的本地记忆模型配置，再启用。",
  prerequisites: "无法读取运行包或模型配置，请检查本地文件与系统安全存储后重试。",
  "stop-failed": "本次已阻止新连接，但服务清理未确认完成。请退出 New Money 后检查，不要把此状态当作已停止。"
};

export function LocalMemoryActivationSettings({ disabled = false, onPendingChange }: {
  disabled?: boolean; onPendingChange: (pending: boolean) => void;
}) {
  const bridge = window.pi67?.system.localMemoryActivation;
  const [snapshot, setSnapshot] = useState<LocalMemoryActivationSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [readError, setReadError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<LocalMemoryHealthCheck["health"]>();
  const mounted = useRef(false), pending = useRef(false), revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    let alive = true, reading = false;
    const refresh = async (initial = false) => {
      if (!alive || reading || pending.current || (!initial && document.hidden)) return;
      reading = true;
      const token = revision.current;
      try {
        const value = await bridge?.get() ?? { available: false } as const;
        if (alive && token === revision.current) { setSnapshot(value); setReadError(undefined); }
      } catch { if (alive && token === revision.current) setReadError("无法读取私人记忆状态，请重新打开此页检查。"); }
      finally { reading = false; }
    };
    void refresh(true);
    const timer = setInterval(() => void refresh(), 2_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      alive = false; mounted.current = false; revision.current++;
      clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible);
    };
  }, [bridge]);
  useEffect(() => { onPendingChange(busy); return () => onPendingChange(false); }, [busy, onPendingChange]);
  useSettingsDraftRegistration({ dirty: busy, busy, subject: "私人记忆启用设置", discard: () => undefined });
  const change = async (enabled: boolean) => {
    if (!bridge || pending.current || disabled) return;
    pending.current = true; revision.current++; setBusy(true); setError(undefined); setHealth(undefined);
    try {
      const value = await bridge.setEnabled(enabled);
      if (mounted.current) setSnapshot(value);
    } catch { if (mounted.current) setError("更改未确认完成。请查看刷新后的实际状态，再决定是否重试；不会自动重启应用。"); }
    finally {
      pending.current = false;
      if (mounted.current) { revision.current++; setBusy(false); }
    }
  };
  const current = snapshot?.available ? snapshot : undefined;
  useEffect(() => { setHealth(undefined); }, [current?.lifecycle, current?.preference]);
  const check = async () => {
    if (!bridge || pending.current || disabled) return;
    pending.current = true;
    const token = ++revision.current;
    setChecking(true); setHealth(undefined); setError(undefined);
    try {
      const result = await bridge.check();
      if (mounted.current && token === revision.current) {
        setSnapshot(result.activation); setReadError(undefined); setHealth(result.health);
      }
    } catch { if (mounted.current && token === revision.current) setError("无法完成本地服务检测，请重试；不会改用手动服务地址。"); }
    finally {
      pending.current = false;
      if (mounted.current && token === revision.current) setChecking(false);
    }
  };
  const unavailable = !current || !bridge;
  const locked = disabled || busy || checking || current?.busy || unavailable;
  const issue = current ? issues[current.issue] : undefined;
  return <SettingsSectionBlock title="私人记忆启用" description="无需登录，记忆留在本机。模型处理使用你配置的服务，可能产生费用；不会上传到 New Money 团队后台。">
    <SettingsRows>
      <SettingsRow title="私人记忆服务" value={!snapshot ? "正在读取…" : !current ? "此平台暂不可用"
        : current.preference === "enabled" ? "已保存启用偏好" : current.preference === "disabled" ? "未启用" : "启用偏好未确认"}
        description="启用后需自行重启 New Money；不会中断当前会话。关闭会停止本地服务，不删除私人数据。"
        actions={<Button className="secondary-button" isDisabled={locked} onPress={() => void change(current?.preference === "disabled")}>
          {busy ? "正在处理…" : current?.preference === "enabled" ? "关闭私人记忆" : current?.preference === "unknown" ? "关闭并保存" : "启用（重启后生效）"}
        </Button>} />
      {current ? <SettingsRow title="本次运行状态" value={states[current.lifecycle]}
        description="由 Desktop 自动管理地址。检测不启动服务、不调用模型，也不读取记忆内容；运行或检测通过不代表已完成记忆学习与召回。"
        actions={<Button className="secondary-button" isDisabled={locked || current.lifecycle !== "running" || current.restartRequired}
          onPress={() => void check()}>{checking ? "正在检测…" : "检测本地服务"}</Button>} /> : null}
    </SettingsRows>
    {health ? <SettingsNotice tone={health === "unavailable" ? "warning" : "info"}>
      {health === "healthy" ? "本次检测通过：当前本地服务可以连接。未调用模型或验证记忆召回。"
        : health === "not-running" ? "当前没有可检测的本地服务。启用并重启后，打开允许使用记忆的会话；检测不会代为启动。"
          : "本地进程仍在运行，但本次健康检测未通过。请稍后重试；不会自动重启或切换服务。"}
    </SettingsNotice> : null}
    {readError || error || issue ? <SettingsNotice tone="danger">{readError ?? error ?? issue}</SettingsNotice> : null}
    {current?.restartRequired && current.preference === "enabled" ? <SettingsNotice tone="info">启用偏好已保存。请先结束当前工作，再退出并重新打开 New Money；本次不会自动启动服务。</SettingsNotice> : null}
    {current?.restartRequired && current.preference === "disabled" ? <SettingsNotice tone="info">关闭偏好已保存；本次服务状态见上方。重启后不再加载私人受管连接。</SettingsNotice> : null}
    {current && (current.lifecycle === "failed" || current.lifecycle === "blocked") ? <SettingsNotice tone="danger">请检查私人运行包签名、模型配置与索引兼容性。连续失败后需重启应用；不会切换到其他服务或模型。</SettingsNotice> : null}
    {disabled ? <SettingsNotice tone="info">请先完成运行包安装，或保存/撤销模型修改，再更改启用设置。</SettingsNotice> : null}
  </SettingsSectionBlock>;
}
