import type { LocalMemoryRuntimeInstallResult, LocalMemoryRuntimePurpose, LocalMemoryRuntimeStatus } from "@pi67/protocol";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { SettingsNotice, SettingsRow, SettingsRows, SettingsSectionBlock } from "./SettingsPrimitives.js";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";

const messages: Record<LocalMemoryRuntimeInstallResult, string> = {
  installed: "运行包已验签并安装。本次安装未改变记忆启用设置，也未调用模型。",
  cancelled: "已取消安装；已有运行包和私人记忆保持不变。",
  failed: "安装未完成。请检查签名目录、可用空间及是否已有同版本；已有数据不会被覆盖。",
  busy: "已有安装正在进行，请等待其完成。",
  unavailable: "此平台暂未提供本地运行包安装。"
};
const runtimes = [
  { purpose: "private", title: "私人记忆运行包", description: "用于本机私人记忆，不随团队登录上传。" },
  { purpose: "team-index-v1", title: "团队索引运行包", description: "用于在本机构建已授权团队知识的索引。" },
  { purpose: "team-query-v1", title: "团队检索运行包", description: "用于查询本机团队索引；检索时仍须核验当前权限。" }
] as const;
export function LocalMemoryRuntimeSettings({ onPendingChange, disabled = false }: { onPendingChange: (pending: boolean) => void; disabled?: boolean }) {
  const bridge = window.pi67?.system.localMemoryRuntime;
  const [statuses, setStatuses] = useState<Partial<Record<LocalMemoryRuntimePurpose, LocalMemoryRuntimeStatus>>>({});
  const [result, setResult] = useState<{ purpose: LocalMemoryRuntimePurpose; value: LocalMemoryRuntimeInstallResult }>();
  const [activePurpose, setActivePurpose] = useState<LocalMemoryRuntimePurpose>();
  const busy = activePurpose !== undefined;
  const [cancelling, setCancelling] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let current = true;
    for (const { purpose } of runtimes) {
      void (bridge?.getStatus(purpose) ?? Promise.resolve("unavailable" as const)).catch(() => "unavailable" as const).then((value) => {
        if (current) setStatuses((previous) => ({ ...previous, [purpose]: value }));
      });
    }
    return () => { current = false; mounted.current = false; if (pending.current) void bridge?.cancel().catch(() => undefined); };
  }, [bridge]);
  useEffect(() => { onPendingChange(busy); return () => onPendingChange(false); }, [busy, onPendingChange]);
  useSettingsDraftRegistration({ dirty: busy, busy, subject: "运行包安装", discard: () => undefined });
  const install = async (purpose: LocalMemoryRuntimePurpose) => {
    if (!bridge || pending.current || disabled) return;
    pending.current = true; setActivePurpose(purpose); setResult(undefined); setCancelling(false);
    try {
      const value = await bridge.install(purpose);
      if (mounted.current) {
        setResult({ purpose, value });
        if (value === "installed") setStatuses((previous) => ({ ...previous, [purpose]: "present" }));
      }
    } catch { if (mounted.current) setResult({ purpose, value: "failed" }); }
    finally { pending.current = false; if (mounted.current) { setActivePurpose(undefined); setCancelling(false); } }
  };
  const cancel = async () => {
    setCancelling(true);
    try { await bridge?.cancel(); } catch { if (mounted.current && activePurpose) { setResult({ purpose: activePurpose, value: "failed" }); setCancelling(false); } }
  };
  return <SettingsSectionBlock title="本地运行包" description="仅安装已签名的本地目录，不下载、不覆盖已有版本，也不会自动开启记忆服务。">
    <SettingsRows>{runtimes.map(({ purpose, title, description }) => {
      const status = statuses[purpose];
      return <SettingsRow key={purpose} title={title} description={description} value={!status ? "正在检查…" : status === "present"
        ? "检测到运行包 · 启动前仍需校验" : status === "missing" ? "尚未安装" : "此平台暂不可用"}
        actions={activePurpose === purpose ? <Button className="secondary-button" isDisabled={cancelling} onPress={() => void cancel()}>{cancelling ? "正在取消…" : "取消安装"}</Button>
          : <Button className="secondary-button" aria-label={`安装${title}`} isDisabled={disabled || busy || status !== "missing"} onPress={() => void install(purpose)}>选择运行包…</Button>} />;
    })}</SettingsRows>
    {busy ? <SettingsNotice tone="info">正在选择、验签或安装运行包，请稍候。取消会等待当前文件操作结束。</SettingsNotice> : null}
    {result ? <SettingsNotice tone={result.value === "failed" ? "danger" : "info"}>
      <span>{runtimes.find(({ purpose }) => purpose === result.purpose)?.title}：</span><span>{messages[result.value]}</span>
    </SettingsNotice> : null}
  </SettingsSectionBlock>;
}
