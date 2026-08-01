import type { ContextFileScope, ContextFileSummary } from "@pi67/domain";
import { ChevronRight, FilePlus2, FileText, LockKeyhole, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "react-aria-components";
import {
  SettingsCatalog,
  SettingsCatalogRow,
  SettingsNotice,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./RuleSettingsWorkspace.module.css";

export type GlobalRuleCategory = "rules" | "managed" | "system";
export type ProjectRuleCategory = "rules" | "inherited" | "system";

interface CatalogProps {
  items: ContextFileSummary[];
  busy: boolean;
  error: string | undefined;
  detail?: ReactNode;
  onRefresh: () => void;
  onSelect: (item: ContextFileSummary) => void;
}

export interface CategoryDefinition<Key extends string> {
  id: Key;
  label: string;
  title: string;
  description: string;
  items: ContextFileSummary[];
}

export function GlobalRuleCatalog({
  category,
  onCategoryChange,
  ...props
}: CatalogProps & {
  category: GlobalRuleCategory;
  onCategoryChange: (category: GlobalRuleCategory) => void;
}) {
  const definitions = globalRuleCategoryDefinitions(props.items);
  return <CategorizedCatalog
    {...props}
    ariaLabel="全局规则与上下文分类"
    category={category}
    definitions={definitions}
    onCategoryChange={onCategoryChange}
  />;
}

export function globalRuleCategoryDefinitions(
  items: ContextFileSummary[]
): Array<CategoryDefinition<GlobalRuleCategory>> {
  return [
    {
      id: "rules",
      label: "全局规则",
      title: "全局规则与上下文",
      description: "由用户维护并对所有项目可用；AGENTS.md 优先于同目录的 CLAUDE.md。",
      items: items.filter((item) => item.scope === "global" && item.category === "rules-context")
    },
    {
      id: "managed",
      label: "桌面托管",
      title: "桌面托管规则",
      description: "随 Desktop 提供并按文件展示；可以查看源码和预览，但不能直接修改。",
      items: items.filter((item) => item.scope === "managed")
    },
    {
      id: "system",
      label: "系统提示词",
      title: "全局系统提示词",
      description: "SYSTEM.md 替换默认系统提示词；APPEND_SYSTEM.md 追加系统提示词。",
      items: items.filter((item) => item.scope === "global" && item.category !== "rules-context")
    }
  ];
}

export function ProjectRuleCatalog({
  category,
  onCategoryChange,
  trusted,
  workspaceName,
  ...props
}: CatalogProps & {
  category: ProjectRuleCategory;
  onCategoryChange: (category: ProjectRuleCategory) => void;
  trusted: boolean;
  workspaceName: string;
}) {
  const definitions = projectRuleCategoryDefinitions(props.items, workspaceName);
  const notice = trusted ? undefined : (
    <SettingsNotice tone="warning">
      当前项目尚未受信任。项目文件可以查看，但创建、编辑和加载保持禁用。
    </SettingsNotice>
  );
  return <CategorizedCatalog
    {...props}
    ariaLabel="项目规则与上下文分类"
    category={category}
    definitions={definitions}
    notice={notice}
    onCategoryChange={onCategoryChange}
  />;
}

export function projectRuleCategoryDefinitions(
  items: ContextFileSummary[],
  workspaceName: string
): Array<CategoryDefinition<ProjectRuleCategory>> {
  const inherited = items.filter((item) => (
    item.scope === "inherited"
    || (item.scope === "global" && item.category === "rules-context" && item.presence === "present")
  ));
  return [
    {
      id: "rules",
      label: "项目规则",
      title: "项目规则与上下文",
      description: `由 ${workspaceName} 维护；仅受信任 Workspace 内的普通 Markdown 文件可编辑。`,
      items: items.filter((item) => item.scope === "project" && item.category === "rules-context")
    },
    {
      id: "inherited",
      label: "继承规则",
      title: "继承的规则与上下文",
      description: "展示全局规则和 Pi 从 Workspace 外父目录继承的有效上下文；父目录条目只读。",
      items: inherited
    },
    {
      id: "system",
      label: "系统提示词",
      title: "项目系统提示词",
      description: "项目 .pi 目录中的 SYSTEM.md 或 APPEND_SYSTEM.md 存在时覆盖对应全局文件。",
      items: items.filter((item) => item.scope === "project" && item.category !== "rules-context")
    }
  ];
}

function CategorizedCatalog<Key extends string>({
  ariaLabel,
  busy,
  category,
  definitions,
  detail,
  error,
  notice,
  onCategoryChange,
  onRefresh,
  onSelect
}: CatalogProps & {
  ariaLabel: string;
  category: Key;
  definitions: Array<CategoryDefinition<Key>>;
  notice?: ReactNode;
  onCategoryChange: (category: Key) => void;
}) {
  const selected = definitions.find((definition) => definition.id === category) ?? definitions[0]!;
  return (
    <div className={styles.catalogSurface}>
      <div aria-label={ariaLabel} className={styles.categoryTabs} role="group">
        {definitions.map((definition) => (
          <Button
            aria-label={definition.label}
            aria-pressed={definition.id === selected.id}
            className={styles.categoryButton!}
            key={definition.id}
            onPress={() => onCategoryChange(definition.id)}
          >
            {definition.label}<span aria-hidden="true">{definition.items.length}</span>
          </Button>
        ))}
      </div>
      {detail !== undefined ? detail : (
        <div className={styles.sections}>
          {notice}
          {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
          <CatalogSection
            actions={<RefreshButton busy={busy} onPress={onRefresh} />}
            description={selected.description}
            items={selected.items}
            onSelect={onSelect}
            title={selected.title}
          />
        </div>
      )}
    </div>
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
                <span>{contextFileRuntimeStateLabel(item.runtimeState)}</span>
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
  if (scope === "managed") return "桌面托管";
  if (scope === "global") return "全局";
  if (scope === "project") return "当前项目";
  return "父目录继承";
}

export function contextFileAccessLabel(item: ContextFileSummary): string {
  if (item.access === "editable") return "可编辑";
  if (item.access === "creatable") return "可新建";
  return item.presence === "missing" ? "不可创建" : "只读";
}

export function contextFileRuntimeStateLabel(state: ContextFileSummary["runtimeState"]): string {
  if (state === "active") return "当前生效";
  if (state === "overridden") return "已被覆盖";
  if (state === "not-loaded") return "尚未加载";
  return "当前不可用";
}
