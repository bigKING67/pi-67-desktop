import type { ContextFileScope, ContextFileSummary } from "@pi67/domain";
import { ChevronDown, ChevronRight, FilePlus2, FileText, LockKeyhole, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "react-aria-components";
import {
  SettingsCatalog,
  SettingsCatalogRow,
  SettingsNotice,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./RuleSettingsWorkspace.module.css";

interface CatalogProps {
  items: ContextFileSummary[];
  busy: boolean;
  error: string | undefined;
  detail?: ReactNode;
  onRefresh: () => void;
  onSelect: (item: ContextFileSummary) => void;
}

export interface GlobalRuleGroups {
  rules: ContextFileSummary[];
  managed: ContextFileSummary[];
  system: ContextFileSummary[];
}

export interface ProjectRuleGroups {
  rules: ContextFileSummary[];
  inherited: ContextFileSummary[];
  system: ContextFileSummary[];
}

export function GlobalRuleCatalog({
  advancedOpen,
  onAdvancedOpenChange,
  ...props
}: CatalogProps & {
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
}) {
  if (props.detail !== undefined) return <div className={styles.catalogSurface}>{props.detail}</div>;
  const groups = globalRuleGroups(props.items);
  const managedCount = presentItemCount(groups.managed);
  const systemCount = presentItemCount(groups.system);
  return (
    <div className={styles.catalogSurface}>
      <div className={styles.sections}>
        <RuleBehaviorNotice />
        {props.error ? <SettingsNotice tone="danger">{props.error}</SettingsNotice> : null}
        <CatalogSection
          actions={<RefreshButton busy={props.busy} onPress={props.onRefresh} />}
          description="适用于所有项目；AGENTS.md 优先于同目录的 CLAUDE.md。"
          items={groups.rules}
          onSelect={props.onSelect}
          title="全局工作规则"
        />
        <AdvancedDisclosure
          description="Pi-67 内置规则与系统提示词覆盖"
          open={advancedOpen}
          statuses={[
            `Pi-67 内置规则 · ${managedCount} 项`,
            `系统提示词覆盖 · ${configuredCountLabel(systemCount)}`
          ]}
          onOpenChange={onAdvancedOpenChange}
        >
          <CatalogSection
            description="随 Pi-67 Desktop 提供的只读内部规则；可查看源码和预览。"
            items={groups.managed}
            onSelect={props.onSelect}
            title="Pi-67 内置规则"
          />
          <CatalogSection
            description="高级设置。通常使用 AGENTS.md 即可；SYSTEM.md 替换默认系统提示词，APPEND_SYSTEM.md 追加默认系统提示词。"
            items={groups.system}
            onSelect={props.onSelect}
            title={`系统提示词覆盖 · ${configuredCountLabel(systemCount)}`}
          />
        </AdvancedDisclosure>
      </div>
    </div>
  );
}

export function globalRuleGroups(items: ContextFileSummary[]): GlobalRuleGroups {
  return {
    rules: items.filter((item) => item.scope === "global" && item.category === "rules-context"),
    managed: items.filter((item) => item.scope === "managed"),
    system: items.filter((item) => item.scope === "global" && item.category !== "rules-context")
  };
}

export function ProjectRuleCatalog({
  advancedOpen,
  onAdvancedOpenChange,
  trusted,
  workspaceName,
  ...props
}: CatalogProps & {
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  trusted: boolean;
  workspaceName: string;
}) {
  if (props.detail !== undefined) return <div className={styles.catalogSurface}>{props.detail}</div>;
  const groups = projectRuleGroups(props.items);
  const systemCount = presentItemCount(groups.system);
  return (
    <div className={styles.catalogSurface}>
      <div className={styles.sections}>
        <RuleBehaviorNotice />
        {!trusted ? (
          <SettingsNotice tone="warning">
            当前项目尚未受信任。项目文件可以查看，但创建、编辑和加载保持禁用。
          </SettingsNotice>
        ) : null}
        {props.error ? <SettingsNotice tone="danger">{props.error}</SettingsNotice> : null}
        <CatalogSection
          actions={<RefreshButton busy={props.busy} onPress={props.onRefresh} />}
          description={`仅适用于 ${workspaceName}；受信任项目中的普通 Markdown 文件可编辑。`}
          items={groups.rules}
          onSelect={props.onSelect}
          title="项目工作规则"
        />
        <CatalogSection
          description="Pi 自动继承全局工作规则和项目父目录中的工作规则；项目目录之外的文件只读。"
          items={groups.inherited}
          onSelect={props.onSelect}
          title="继承的工作规则"
        />
        <AdvancedDisclosure
          description="项目级系统提示词覆盖"
          open={advancedOpen}
          statuses={[`系统提示词覆盖 · ${configuredCountLabel(systemCount)}`]}
          onOpenChange={onAdvancedOpenChange}
        >
          <CatalogSection
            description="高级设置。通常使用 AGENTS.md 即可；项目 .pi 目录中的文件存在时覆盖对应全局系统提示词文件。"
            items={groups.system}
            onSelect={props.onSelect}
            title={`系统提示词覆盖 · ${configuredCountLabel(systemCount)}`}
          />
        </AdvancedDisclosure>
      </div>
    </div>
  );
}

export function projectRuleGroups(items: ContextFileSummary[]): ProjectRuleGroups {
  return {
    rules: items.filter((item) => item.scope === "project" && item.category === "rules-context"),
    inherited: items.filter((item) => (
      item.scope === "inherited"
      || (item.scope === "global" && item.category === "rules-context" && item.presence === "present")
    )),
    system: items.filter((item) => item.scope === "project" && item.category !== "rules-context")
  };
}

export function presentItemCount(items: ContextFileSummary[]): number {
  return items.filter((item) => item.presence === "present").length;
}

function configuredCountLabel(count: number): string {
  return count === 0 ? "未配置" : `${count} 项`;
}

function RuleBehaviorNotice() {
  return (
    <SettingsNotice className={styles.behaviorNotice!}>
      工作规则由 Pi 自动加载，并在会话中持续生效。提示词模板只有通过 <code>/名称</code> 调用时才会加入当前消息。
    </SettingsNotice>
  );
}

function AdvancedDisclosure({
  children,
  description,
  open,
  statuses,
  onOpenChange
}: {
  children: ReactNode;
  description: string;
  open: boolean;
  statuses: string[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <details
      className={styles.advancedDetails}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary>
        <span className={styles.advancedIdentity}>
          <strong>高级</strong>
          <small>{description}</small>
        </span>
        <span className={styles.advancedStatuses}>
          {statuses.map((status) => <span key={status}>{status}</span>)}
        </span>
        <ChevronDown aria-hidden="true" className={styles.advancedChevron} size={16} />
      </summary>
      <div className={styles.advancedSections}>{children}</div>
    </details>
  );
}

function CatalogSection({ title, description, items, actions, onSelect }: {
  title: string;
  description: string;
  items: ContextFileSummary[];
  actions?: ReactNode;
  onSelect: (item: ContextFileSummary) => void;
}) {
  return (
    <SettingsSectionBlock title={title} description={description} {...(actions ? { actions } : {})}>
      {items.length === 0 ? <SettingsNotice>当前没有可显示的 Markdown 文件。</SettingsNotice> : (
        <SettingsCatalog label={title}>
          {items.map((item) => (
            <SettingsCatalogRow
              description={<span className={styles.path}>{item.path}</span>}
              key={item.id}
              leading={item.presence === "missing"
                ? <FilePlus2 aria-hidden="true" size={17} />
                : item.access === "read-only"
                  ? <LockKeyhole aria-hidden="true" size={17} />
                  : <FileText aria-hidden="true" size={17} />}
              meta={<span className={styles.meta}>
                <span>{contextFileScopeLabel(item.scope)}</span>
                <span>{contextFileAccessLabel(item)}</span>
                <span>{contextFileStatusLabel(item)}</span>
              </span>}
              onSelect={() => onSelect(item)}
              testId={`context-file-${item.id}`}
              title={item.name}
              trailing={<ChevronRight aria-hidden="true" size={15} />}
            />
          ))}
        </SettingsCatalog>
      )}
    </SettingsSectionBlock>
  );
}

function RefreshButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return (
    <Button className="secondary-button" isDisabled={busy} onPress={onPress}>
      <RefreshCw aria-hidden="true" className={busy ? styles.spinning : undefined} size={14} />刷新
    </Button>
  );
}

export function contextFileScopeLabel(scope: ContextFileScope): string {
  if (scope === "managed") return "Pi-67 内置";
  if (scope === "global") return "全局";
  if (scope === "project") return "当前项目";
  return "父目录继承";
}

export function contextFileAccessLabel(item: ContextFileSummary): string {
  if (item.access === "editable") return "可编辑";
  if (item.access === "creatable") return "可创建";
  return item.presence === "missing" ? "不可创建" : "只读";
}

export function contextFileStatusLabel(item: ContextFileSummary): string {
  if (item.presence === "missing") return "尚未创建";
  if (item.runtimeState === "active") return "当前生效";
  if (item.runtimeState === "overridden") return "已配置 · 当前未生效";
  if (item.runtimeState === "not-loaded") return "已配置 · 尚未加载";
  return "当前不可用";
}
