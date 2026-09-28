import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { FileJson2, RefreshCw, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { SettingsIconAction, SettingsStatus, SettingsToolbar, useRequiredOpenDisclosure } from "./SettingsPrimitives.js";
import styles from "./ProviderConfigurationPanel.module.css";

export function ProviderConfigurationFiles({ snapshot }: { snapshot: PiProviderConfigurationSnapshot }) {
  const validCount = snapshot.files.filter((file) => file.valid).length;
  const disclosure = useRequiredOpenDisclosure(snapshot.syncState === "invalid" || snapshot.diagnostics.length > 0);
  return (
    <section className={styles.secondarySection}>
      <header className={styles.sectionIntro}>
        <strong>文件与诊断</strong>
        <small>Pi 文件是唯一真源；正常状态保持紧凑，发生错误时自动展开。</small>
      </header>
      {snapshot.diagnostics.length ? (
        <ul className={styles.diagnostics}>
          {snapshot.diagnostics.map((item, index) => (
            <li key={`${item.file}-${index}`}><strong>{item.file}</strong>{item.message}</li>
          ))}
        </ul>
      ) : null}
      <details className={styles.fileDetails} {...disclosure}>
        <summary>
          <span><FileJson2 aria-hidden="true" size={15} /><strong>Pi 文件同步</strong></span>
          <em data-valid={validCount === snapshot.files.length}>{validCount}/{snapshot.files.length} 有效</em>
        </summary>
        <p>Desktop 与 Pi TUI 共用配置 · revision {snapshot.revision.slice(0, 10)}</p>
        <div className={styles.fileList}>{snapshot.files.map((file) => (
          <div key={file.kind}>
            <FileJson2 aria-hidden="true" size={15} />
            <span><strong>{file.kind}</strong><small title={file.path}>{file.path}</small></span>
            <em data-valid={file.valid}>{file.valid ? "有效" : "无效"}</em>
          </div>
        ))}</div>
      </details>
    </section>
  );
}

export function ProviderConfigurationStatusBar({
  snapshot,
  busy,
  onReload,
  catalogBusy = false,
  onRefreshCatalog
}: {
  snapshot: PiProviderConfigurationSnapshot;
  busy: boolean;
  onReload: () => void;
  catalogBusy?: boolean;
  onRefreshCatalog?: () => void;
}) {
  return <SettingsToolbar
    className={styles.statusBar!}
    status={<SettingsStatus tone={snapshot.syncState === "current" ? "success" : "warning"}>
      {snapshot.syncState === "current" ? "配置已同步" : "配置需要处理"}
    </SettingsStatus>}
    actions={<>
      {onRefreshCatalog ? <SettingsIconAction
        label={catalogBusy ? "刷新目录中…" : "刷新模型目录"}
        icon={<RefreshCw aria-hidden="true" size={14} />}
        isDisabled={busy || catalogBusy}
        onPress={onRefreshCatalog}
      /> : null}
      <SettingsIconAction
        label="重新加载配置"
        icon={<RotateCcw aria-hidden="true" size={14} />}
        isDisabled={busy || catalogBusy}
        onPress={onReload}
      />
    </>}
  />;
}

export function ProviderConfigurationEmpty({
  title,
  detail,
  action
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return <div className={styles.panelEmpty} role="status">
    <strong>{title}</strong><span>{detail}</span>{action}
  </div>;
}
