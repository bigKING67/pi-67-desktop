import {
  nativeCapabilityReplacement,
  nativeCapabilityReplacementLabel,
  type ExtensionPackageEntry,
  type PackageResourceType
} from "@pi67/domain";
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Download,
  RefreshCw,
  Trash2
} from "lucide-react";
import { Button } from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import type { ConfirmedAction, PackageRow } from "./extension-management-model.js";
import {
  packageResourceEnabled,
  packageResourceTypes,
  packageContentAdmitted,
  packageRowAccessibleName,
  packageRowName,
  packageRowState,
  packageTrustLabel,
  packageTrustReasonLabel,
  resolveSourceKind,
  sourceKindLabel
} from "./extension-management-model.js";
import {
  SettingsDetailHeader,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsStatus,
  type SettingsStatusTone
} from "./SettingsPrimitives.js";
import packageStyles from "./ExtensionPackageBrowser.module.css";
import styles from "./ExtensionManagementWorkspace.module.css";

export function PackageList({ rows, selectedKey, loading, updateDisabled, onSelect, onUpdate }: {
  rows: PackageRow[];
  selectedKey: string | undefined;
  loading: boolean;
  updateDisabled: boolean;
  onSelect: (key: string) => void;
  onUpdate: (entry: ExtensionPackageEntry) => void;
}) {
  if (loading && rows.length === 0) {
    return <div className={styles.listEmpty} role="status"><RefreshCw aria-hidden="true" size={16} />正在读取扩展包…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className={styles.listEmpty} role="status">
        <Box aria-hidden="true" size={18} />
        <strong>没有匹配的扩展包</strong>
        <span>调整搜索或筛选条件后重试。</span>
      </div>
    );
  }
  return (
    <div className={styles.listPane} data-testid="extension-package-list-scroll">
      <span className={packageStyles.groupLabel}>第三方扩展包</span>
      <ul aria-label="已安装扩展包" className={packageStyles.packageList}>
        {rows.map((row) => (
          <li className={packageStyles.packageRow} data-selected={selectedKey === row.key || undefined} key={row.key}>
            <Button
              aria-label={packageRowAccessibleName(row)}
              aria-pressed={selectedKey === row.key}
              className={packageStyles.packageButton!}
              data-package-focus-action="details"
              data-package-focus-key={row.key}
              data-selected={selectedKey === row.key || undefined}
              onPress={() => onSelect(row.key)}
            >
              <span className={packageStyles.packageIdentity}>
                <strong>{packageRowName(row)}</strong>
                <PackageRowMeta row={row} />
              </span>
              <PackageState row={row} />
              <ChevronRight aria-hidden="true" className={packageStyles.chevron} size={15} />
            </Button>
            {row.update ? (
              <Button
                aria-label={`更新 ${row.entry.source}`}
                className={`secondary-button ${packageStyles.packageUpdateAction}`}
                data-package-focus-action="update"
                data-package-focus-key={row.key}
                isDisabled={updateDisabled}
                onPress={() => onUpdate(row.entry)}
              ><Download aria-hidden="true" size={13} />更新</Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PackageDetails({ row, workspaceName, updatesChecked, updateDisabled, onApprove, onBack, onPending, onRestore, onToggle }: {
  row: PackageRow | undefined;
  workspaceName: string | undefined;
  updatesChecked: boolean;
  updateDisabled: boolean;
  onApprove: (entry: ExtensionPackageEntry) => void;
  onBack: () => void;
  onPending: (action: ConfirmedAction) => void;
  onRestore: (entry: ExtensionPackageEntry) => void;
  onToggle: (entry: ExtensionPackageEntry, inherited: boolean, resourceType: PackageResourceType) => void;
}) {
  if (!row) {
    return (
      <div className={styles.detailEmpty}>
        <Box aria-hidden="true" size={20} />
        <strong>选择一个扩展包查看详情</strong>
        <span>来源、作用域、提供的资源和安全操作会显示在这里。</span>
      </div>
    );
  }
  const resourceTypes = packageResourceTypes(row.entry);
  const replacement = nativeCapabilityReplacement(row.entry.source);
  const status = packageDetailStatus(row);
  const canApprove = row.entry.installed
    && (row.entry.trustState === "unverified" || row.entry.trustState === "drifted");
  const scopeLabel = row.inherited
    ? "继承自全局"
    : row.entry.scope === "global" ? "全局" : `项目 · ${workspaceName ?? "当前项目"}`;
  const meta = [sourceKindLabel(resolveSourceKind(row.entry)), row.entry.version, scopeLabel]
    .filter(Boolean)
    .join(" · ");
  return (
    <section
      aria-label={`${packageRowName(row)} 详情`}
      className={`${styles.details} ${packageStyles.detail}`}
      data-testid="extension-package-detail-scroll"
    >
      <SettingsDetailHeader
        actions={<>
          {row.update ? (
            <Button
              aria-label={`更新 ${row.entry.source}`}
              className="secondary-button"
              isDisabled={updateDisabled}
              onPress={() => onPending({ kind: "update", entry: row.entry })}
            ><Download aria-hidden="true" size={14} />更新</Button>
          ) : null}
          {!row.inherited && row.entry.scope === "project" ? (
            <Button
              aria-label={`恢复继承 ${row.entry.source}`}
              className="secondary-button"
              onPress={() => onRestore(row.entry)}
            >恢复全局继承</Button>
          ) : null}
          {canApprove ? (
            <Button
              aria-label={`${row.entry.trustState === "drifted" ? "重新确认" : "确认"} ${row.entry.source} 当前内容`}
              className="primary-button"
              isDisabled={updateDisabled}
              onPress={() => onApprove(row.entry)}
            >{row.entry.trustState === "drifted" ? "重新确认当前内容" : "确认当前内容"}</Button>
          ) : null}
        </>}
        back={<DetailBackButton onBack={onBack} />}
        meta={meta}
        status={<>
          {status ? <SettingsStatus tone={status.tone}>{status.label}</SettingsStatus> : null}
          {row.update ? <SettingsStatus tone="warning">有可用更新</SettingsStatus> : null}
          {!row.entry.installed ? <SettingsStatus tone="danger">安装内容缺失</SettingsStatus> : null}
        </>}
        title={packageRowName(row)}
      />
      <p className={packageStyles.description}>
        {messages.settings.extensionPackages.purpose(
          row.entry.source,
          row.entry.displayName,
          row.entry.description
        )}
      </p>
      {replacement ? (
        <SettingsNotice><strong>{nativeCapabilityReplacementLabel(replacement)}</strong>。现有用户配置保持不变，但 Desktop Task 不再加载该扩展。</SettingsNotice>
      ) : null}
      <CapabilitySummary resourceTypes={resourceTypes} />
      <SettingsRows>
        <SettingsRow description={<span className={packageStyles.code}>{row.entry.source}</span>} title="来源" />
        <SettingsRow title="资源过滤" value={row.entry.filtered ? "仅启用选定资源类型" : "使用包默认资源"} />
        <SettingsRow title="信任状态" value={packageTrustLabel(row.entry)} />
        {packageTrustReasonLabel(row.entry)
          ? <SettingsRow title="完整性说明" value={packageTrustReasonLabel(row.entry)!} />
          : null}
        {row.entry.trustObservedAt
          ? <SettingsRow title="最后核对" value={new Date(row.entry.trustObservedAt).toLocaleString("zh-CN")} />
          : null}
        <SettingsRow title="更新" value={row.update ? "发现可用更新" : updatesChecked ? "未发现更新" : "尚未检查"} />
      </SettingsRows>
      <div aria-label="资源启用状态" role="group">
        <SettingsRows>
          {resourceTypes.map((resourceType) => {
            const resourceEnabled = packageResourceEnabled(row.entry, resourceType);
            return (
              <SettingsRow
                actions={<Button
                  aria-label={`${resourceEnabled ? "停用" : "启用"} ${resourceTypeLabel(resourceType)} ${row.entry.source}`}
                  className="secondary-button"
                  isDisabled={replacement !== undefined || !packageContentAdmitted(row.entry)}
                  onPress={() => onToggle(row.entry, row.inherited, resourceType)}
                >{resourceEnabled ? "停用" : "启用"}</Button>}
                description={resourceEnabled ? "当前作用域已启用" : "当前作用域已停用"}
                key={resourceType}
                title={resourceTypeLabel(resourceType)}
              />
            );
          })}
        </SettingsRows>
      </div>
      {!row.inherited ? (
        <div className={styles.dangerZone} data-testid="extension-danger-zone">
          <span><strong>移除扩展包</strong><small>将同时移除这个扩展包提供的扩展、技能、提示词模板和主题；本地目录只移除配置引用。</small></span>
          <Button
            aria-label={`卸载 ${row.entry.source}`}
            className={styles.dangerButton!}
            onPress={() => onPending({ kind: "uninstall", entry: row.entry })}
          ><Trash2 aria-hidden="true" size={14} />卸载</Button>
        </div>
      ) : null}
    </section>
  );
}

function PackageRowMeta({ row }: { row: PackageRow }) {
  return (
    <small>
      <span className={packageStyles.source}>{row.entry.source}</span>
      <span>· {row.inherited ? "继承自全局" : row.entry.scope === "global" ? "全局" : "当前项目"}</span>
    </small>
  );
}

/** Only exceptions carry a status in the list; an enabled Package shows none. */
function PackageState({ row }: { row: PackageRow }) {
  const state = packageRowState(row);
  if (state === "native-replaced") return <SettingsStatus tone="neutral">原生替代</SettingsStatus>;
  if (state === "disabled") return <SettingsStatus tone="neutral">已停用</SettingsStatus>;
  if (state === "partial") return <SettingsStatus tone="warning">部分启用</SettingsStatus>;
  if (state === "not-installed") return <SettingsStatus tone="danger">未安装</SettingsStatus>;
  if (state === "pending-confirmation") return <SettingsStatus tone="warning">待确认</SettingsStatus>;
  if (state === "changed-pending-confirmation") return <SettingsStatus tone="warning">内容已变更</SettingsStatus>;
  return null;
}

function packageDetailStatus(row: PackageRow): { label: string; tone: SettingsStatusTone } | undefined {
  const state = packageRowState(row);
  if (state === "native-replaced") return { label: "原生能力替代", tone: "neutral" };
  if (state === "enabled") return { label: "已启用", tone: "success" };
  if (state === "partial") return { label: "部分启用", tone: "warning" };
  if (state === "pending-confirmation") return { label: "待确认", tone: "warning" };
  if (state === "changed-pending-confirmation") return { label: "内容已变更，待重新确认", tone: "warning" };
  if (state === "not-installed") return { label: "未安装", tone: "danger" };
  return { label: "已停用", tone: "neutral" };
}

function DetailBackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button
      aria-label="返回扩展包列表"
      className={styles.detailBackButton!}
      data-package-focus-action="detail-back"
      onPress={onBack}
    >
      <ArrowLeft aria-hidden="true" size={14} />扩展包列表
    </Button>
  );
}

function CapabilitySummary({ resourceTypes }: { resourceTypes: readonly string[] }) {
  return (
    <p aria-label="扩展包提供的资源类型" className={packageStyles.capabilities}>
      提供{resourceTypes.map(resourceTypeLabel).join("、")}
    </p>
  );
}

function resourceTypeLabel(type: string): string {
  if (type === "extension") return "扩展";
  if (type === "skill") return "技能";
  if (type === "prompt") return "提示词模板";
  if (type === "theme") return "主题";
  if (type === "rule") return "规则";
  if (type === "integration") return "集成";
  return type;
}

