import type { ExtensionPackageEntry } from "@pi67/domain";
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  CircleAlert,
  CircleOff,
  Download,
  RefreshCw,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { Button } from "react-aria-components";
import type {
  BundledPackageRow,
  ConfirmedAction,
  PackageRow
} from "./extension-management-model.js";
import {
  packageResourceEnabled,
  packageRowAccessibleName,
  packageRowName,
  packageRowState,
  packageRowSummary,
  resolveSourceKind,
  sourceKindLabel
} from "./extension-management-model.js";
import styles from "./ExtensionManagementWorkspace.module.css";

export function PackageList({ rows, selectedKey, loading, onSelect }: {
  rows: PackageRow[];
  selectedKey: string | undefined;
  loading: boolean;
  onSelect: (key: string) => void;
}) {
  if (loading && rows.length === 0) {
    return <div className={styles.listEmpty} role="status"><RefreshCw aria-hidden="true" size={16} />正在读取扩展…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className={styles.listEmpty} role="status">
        <Box aria-hidden="true" size={18} />
        <strong>没有匹配的扩展</strong>
        <span>调整搜索或筛选条件后重试。</span>
      </div>
    );
  }
  let currentGroup: string | undefined;
  return (
    <div className={styles.listPane} data-testid="extension-package-list-scroll">
      <ul aria-label="已安装扩展" className={styles.packageList}>
        {rows.map((row) => {
          const group = row.kind === "bundled" ? "随应用提供" : "外部安装";
          const showGroup = currentGroup !== group;
          currentGroup = group;
          return (
            <li key={row.key}>
              {showGroup ? <span className={styles.groupLabel}>{group}</span> : null}
              <Button
                aria-label={packageRowAccessibleName(row)}
                aria-pressed={selectedKey === row.key}
                className={styles.packageButton!}
                data-selected={selectedKey === row.key || undefined}
                onPress={() => onSelect(row.key)}
              >
                <PackageState row={row} />
                <span className={styles.packageIdentity}>
                  <strong>{packageRowName(row)}</strong>
                  <PackageRowMeta row={row} />
                </span>
                {row.kind === "configured" && row.update ? <span className={styles.updateFlag}>可更新</span> : null}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PackageDetails({ row, workspaceName, updatesChecked, onBack, onPending, onRestore, onToggle }: {
  row: PackageRow | undefined;
  workspaceName: string | undefined;
  updatesChecked: boolean;
  onBack: () => void;
  onPending: (action: ConfirmedAction) => void;
  onRestore: (entry: ExtensionPackageEntry) => void;
  onToggle: (entry: ExtensionPackageEntry, inherited: boolean) => void;
}) {
  if (!row) {
    return (
      <div className={styles.detailEmpty}>
        <Box aria-hidden="true" size={20} />
        <strong>选择一个扩展查看详情</strong>
        <span>来源、作用域、更新和安全操作会显示在这里。</span>
      </div>
    );
  }
  if (row.kind === "bundled") return <BundledPackageDetails row={row} onBack={onBack} />;
  const enabled = packageResourceEnabled(row.entry);
  return (
    <section
      aria-label={`${packageRowName(row)} 详情`}
      className={styles.details}
      data-testid="extension-package-detail-scroll"
    >
      <DetailBackButton onBack={onBack} />
      <header className={styles.detailHeader}>
        <span className={styles.eyebrow}>外部安装</span>
        <h2>{packageRowName(row)}</h2>
        <div className={styles.statusLine}>
          <span data-state={enabled ? "ready" : "neutral"}>{enabled ? "已启用" : "已停用"}</span>
          {row.update ? <span data-state="update">有可用更新</span> : null}
          {!row.entry.installed ? <span data-state="danger">安装内容缺失</span> : null}
        </div>
      </header>
      <p className={styles.detailDescription}>
        {row.entry.description
          ?? "该扩展没有在本地包清单中提供功能说明。可在“当前会话”中查看 Pi Runtime 实际加载的能力。"}
      </p>
      <CapabilitySummary resourceTypes={row.entry.resourceTypes ?? ["extension"]} />
      <dl className={styles.facts}>
        <Fact label="来源" value={row.entry.source} code />
        {row.entry.version ? <Fact label="版本" value={row.entry.version} code /> : null}
        <Fact label="类型" value={sourceKindLabel(resolveSourceKind(row.entry))} />
        <Fact
          label="作用域"
          value={row.inherited
            ? "继承自全局"
            : row.entry.scope === "global" ? "全局" : `项目 · ${workspaceName ?? "当前项目"}`}
        />
        <Fact label="资源过滤" value={row.entry.filtered ? "仅启用选定资源类型" : "使用包默认资源"} />
        <Fact label="更新" value={row.update ? "发现可用更新" : updatesChecked ? "未发现更新" : "尚未检查"} />
      </dl>
      <div className={styles.detailActions}>
        <Button
          aria-label={`${enabled ? "停用" : "启用"} ${row.entry.source}`}
          className={enabled ? "secondary-button" : "primary-button"}
          onPress={() => onToggle(row.entry, row.inherited)}
        >{enabled ? "停用扩展" : "启用扩展"}</Button>
        {row.update ? (
          <Button
            aria-label={`更新 ${row.entry.source}`}
            className="secondary-button"
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
      </div>
      {!row.inherited ? (
        <div className={styles.dangerZone} data-testid="extension-danger-zone">
          <span><strong>移除扩展</strong><small>npm/Git 内容由 Pi 移除；本地目录只移除配置引用。</small></span>
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
  if (row.kind === "bundled") return <small>{packageRowSummary(row)}</small>;
  return (
    <small>
      <span className={styles.packageSource}>{row.entry.source}</span>
      <span>· {row.inherited ? "继承自全局" : row.entry.scope === "global" ? "全局" : "当前项目"}</span>
    </small>
  );
}

function PackageState({ row }: { row: PackageRow }) {
  const state = packageRowState(row);
  if (state === "enabled") {
    return <span className={styles.state} data-state="enabled"><CheckCircle2 aria-hidden="true" size={15} /><span>已启用</span></span>;
  }
  if (state === "disabled") {
    return <span className={styles.state} data-state="disabled"><CircleOff aria-hidden="true" size={15} /><span>已停用</span></span>;
  }
  if (state === "unavailable") {
    return <span className={styles.state} data-state="unavailable"><CircleAlert aria-hidden="true" size={15} /><span>缺失</span></span>;
  }
  return <span className={styles.state} data-state="bundled"><ShieldCheck aria-hidden="true" size={15} /><span>内置</span></span>;
}

function BundledPackageDetails({ row, onBack }: { row: BundledPackageRow; onBack: () => void }) {
  return (
    <section
      aria-label={`${row.entry.displayName} 详情`}
      className={styles.details}
      data-testid="extension-package-detail-scroll"
    >
      <DetailBackButton onBack={onBack} />
      <header className={styles.detailHeader}>
        <span className={styles.eyebrow}>随应用提供</span>
        <h2>{row.entry.displayName}</h2>
        <div className={styles.statusLine}>
          <span data-state={row.entry.installed ? "ready" : "danger"}>
            {row.entry.installed ? "已安装" : "安装内容缺失"}
          </span>
          <span>官方内置</span>
        </div>
      </header>
      <p className={styles.detailDescription}>
        随 π 应用提供的核心能力包，为 Desktop 提供经过固定版本校验的资源。
      </p>
      <CapabilitySummary resourceTypes={row.entry.resourceTypes} />
      <dl className={styles.facts}>
        <Fact label="版本" value={row.entry.version} code />
        <Fact label="固定版本" value={row.entry.commit.slice(0, 12)} code />
        <Fact label="资源" value={row.entry.resourceTypes.join(" · ")} />
        <Fact label="默认状态" value={row.entry.defaultEnabled ? "启用" : "停用"} />
        <Fact label="更新方式" value="随 π 应用更新" />
      </dl>
      <div className={styles.integrityNote}>
        <ShieldCheck aria-hidden="true" size={18} />
        <span><strong>固定供应链身份</strong><small>应用按 Git commit 和 tree SHA-256 校验并替换内置基线，不能独立卸载。</small></span>
      </div>
    </section>
  );
}

function DetailBackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button aria-label="返回扩展列表" className={styles.detailBackButton!} onPress={onBack}>
      <ArrowLeft aria-hidden="true" size={14} />扩展列表
    </Button>
  );
}

function CapabilitySummary({ resourceTypes }: { resourceTypes: readonly string[] }) {
  return (
    <div className={styles.capabilitySummary} aria-label="扩展提供的资源类型">
      <span className={styles.capabilityLabel}>提供能力</span>
      <span className={styles.capabilityBadges}>
        {resourceTypes.map((type) => <span key={type}>{resourceTypeLabel(type)}</span>)}
      </span>
    </div>
  );
}

function resourceTypeLabel(type: string): string {
  if (type === "extension") return "Extension";
  if (type === "skill") return "Skill";
  if (type === "prompt") return "Prompt";
  if (type === "theme") return "Theme";
  if (type === "rule") return "Rule";
  return type;
}

function Fact({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return <div><dt>{label}</dt><dd className={code ? styles.codeValue : undefined}>{value}</dd></div>;
}
