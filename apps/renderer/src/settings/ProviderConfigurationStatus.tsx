import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { CloudDownload, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import {
  SettingsDetails,
  SettingsIconAction,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsStatus,
  SettingsToolbar
} from "./SettingsPrimitives.js";
import styles from "./ProviderConfigurationPanel.module.css";

export function ProviderConfigurationFiles({ snapshot }: { snapshot: PiProviderConfigurationSnapshot }) {
  const validCount = snapshot.files.filter((file) => file.valid).length;
  return (
    <section className={styles.files}>
      {snapshot.diagnostics.length ? (
        <SettingsNotice tone="danger">
          <ul className={styles.diagnostics}>
            {snapshot.diagnostics.map((item, index) => (
              <li key={`${item.file}-${index}`}><strong>{item.file}</strong>{item.message}</li>
            ))}
          </ul>
        </SettingsNotice>
      ) : null}
      <SettingsDetails
        requiredOpen={snapshot.syncState === "invalid" || snapshot.diagnostics.length > 0}
        summary={`${validCount}/${snapshot.files.length} 有效 · revision ${snapshot.revision.slice(0, 10)}`}
        title="Pi 文件同步"
      >
        <SettingsRows>
          {snapshot.files.map((file) => (
            <SettingsRow
              description={<span className={styles.filePath} title={file.path}>{file.path}</span>}
              key={file.kind}
              title={file.kind}
              value={<SettingsStatus tone={file.valid ? "success" : "danger"}>{file.valid ? "有效" : "无效"}</SettingsStatus>}
            />
          ))}
        </SettingsRows>
      </SettingsDetails>
    </section>
  );
}

export function ProviderConfigurationStatusBar({
  snapshot,
  busy,
  onReload,
  catalogBusy = false,
  onRefreshCatalog,
  inline = false
}: {
  snapshot: PiProviderConfigurationSnapshot;
  busy: boolean;
  onReload: () => void;
  catalogBusy?: boolean;
  onRefreshCatalog?: () => void;
  /** Sits inside the catalog command band instead of occupying its own row. */
  inline?: boolean;
}) {
  return <SettingsToolbar
    className={inline ? styles.statusInline! : styles.statusBar!}
    status={snapshot.syncState === "current" ? null : <SettingsStatus tone="warning">配置需要处理</SettingsStatus>}
    actions={<>
      {onRefreshCatalog ? <SettingsIconAction
        label={catalogBusy ? "刷新目录中…" : "刷新模型目录"}
        icon={<CloudDownload aria-hidden="true" size={14} />}
        isDisabled={busy || catalogBusy}
        onPress={onRefreshCatalog}
      /> : null}
      <SettingsIconAction
        label="重新加载配置"
        icon={<RefreshCw aria-hidden="true" size={14} />}
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
