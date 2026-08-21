import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { AlertTriangle, Check, FileJson2, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { SettingsToolbar } from "./SettingsPrimitives.js";
import styles from "./ProviderConfigurationPanel.module.css";

export function ProviderConfigurationFiles({ snapshot }: { snapshot: PiProviderConfigurationSnapshot }) {
  const validCount = snapshot.files.filter((file) => file.valid).length;
  const [expanded, setExpanded] = useState(snapshot.syncState === "invalid" || snapshot.diagnostics.length > 0);
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
      <details
        className={styles.fileDetails}
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <span><FileJson2 aria-hidden="true" size={15} /><strong>Pi 文件同步</strong></span>
          <em data-valid={validCount === snapshot.files.length}>{validCount}/{snapshot.files.length} 有效</em>
        </summary>
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
  onReload
}: {
  snapshot: PiProviderConfigurationSnapshot;
  busy: boolean;
  onReload: () => void;
}) {
  return <SettingsToolbar
    className={styles.statusBar!}
    status={<span className={styles.syncStatus} data-current={snapshot.syncState === "current"}>
      {snapshot.syncState === "current"
        ? <Check aria-hidden="true" size={14} />
        : <AlertTriangle aria-hidden="true" size={14} />}
      <strong>{snapshot.syncState === "current" ? "已与当前用户 Pi Profile 同步" : "Pi Profile 需要处理"}</strong>
      <small>Desktop 与 Pi TUI 双向共用 · revision {snapshot.revision.slice(0, 10)}</small>
    </span>}
    actions={<Button className="secondary-button" isDisabled={busy} onPress={onReload}>
      <RefreshCw aria-hidden="true" size={14} />重新加载
    </Button>}
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
