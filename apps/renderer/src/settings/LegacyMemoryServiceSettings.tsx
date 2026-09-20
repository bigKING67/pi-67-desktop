import type { ContextRuntimeStatus } from "@pi67/domain";
import { Database } from "lucide-react";
import { Button, Input } from "react-aria-components";
import { healthLabel } from "./ContextMemorySettingsPresentation.js";
import { SettingsRow, SettingsRows, SettingsSectionBlock } from "./SettingsPrimitives.js";
import styles from "./ContextMemorySettings.module.css";

/** Compatibility diagnostics never describe or select the managed local service. */
export function LegacyMemoryServiceSettings({ status, endpoint, checked, checking, busy, changed, onEndpointChange, onCheck }: {
  status: ContextRuntimeStatus; endpoint: string; checked: boolean; checking: boolean;
  busy: boolean; changed: boolean; onEndpointChange: (endpoint: string) => void; onCheck: () => void;
}) {
  return <SettingsSectionBlock title="兼容服务（手动地址）" description="仅供非受管运行方式使用。Desktop 管理的私人记忆不使用此地址；此处检测结果不代表本地私人记忆状态，也不会触发服务切换。">
    <SettingsRows>
      <SettingsRow leading={<Database aria-hidden="true" size={17} />} title="手动地址检测" value={checked ? healthLabel(status.health) : "尚未检测"}
        actions={<Button className="secondary-button" isDisabled={busy || changed} onPress={onCheck}>{checking ? "正在测试…" : "检测手动地址"}</Button>} />
      <SettingsRow title="服务地址" description="仅保存兼容配置，不更改 Desktop 管理的本地服务。远程使用 HTTPS；HTTP 仅允许本机回环地址。">
        <Input aria-label="OpenViking 服务地址" className={styles.input!} value={endpoint} disabled={busy}
          onChange={(event) => onEndpointChange(event.currentTarget.value)} />
      </SettingsRow>
    </SettingsRows>
    {changed ? <p className={styles.note}>有未保存的更改。保存后可检测手动地址。</p> : null}
    {checked && status.detail ? <p className={styles.note}>{status.detail}</p> : null}
  </SettingsSectionBlock>;
}
