import type { ResourceSummary } from "@pi67/domain";
import { useAppStore } from "../app/app-store.js";
import { SessionResourceReloadButton } from "../session/SessionResourceReloadButton.js";
import {
  currentSessionResourceTask,
  sessionResourceProjectionMatchesTask
} from "../session/session-control-controller.js";
import {
  selectSessionResourceCatalog,
  selectSessionResources
} from "../session/session-projection-selectors.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import styles from "./SettingsWorkbench.module.css";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";

export function SessionResourcePanel({
  kind,
  origin,
  resourceScope,
  scope: requestedScope,
  title,
  description,
  empty,
  excludeIds
}: {
  kind: ResourceSummary["kind"];
  origin?: ResourceSummary["origin"];
  resourceScope?: ResourceSummary["scope"];
  scope?: "global" | "project";
  title: string;
  description: string;
  empty: string;
  excludeIds?: ReadonlySet<string>;
}) {
  const settingsScope = useWorkbenchStore((state) => state.settingsScope);
  const scope = requestedScope ?? settingsScope;
  const projectedResources = useSessionProjectionStore(selectSessionResources);
  const projectedResourceCatalog = useSessionProjectionStore(selectSessionResourceCatalog);
  const projectionAuthority = useSessionProjectionStore((state) => state.authority);
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const task = useWorkbenchStore(currentSessionResourceTask);
  const projectionMatches = sessionResourceProjectionMatchesTask(
    task,
    projectionAuthority,
    connected ? hostEpoch : undefined
  );
  const resources = projectionMatches ? projectedResources : undefined;
  const resourceCatalog = projectionMatches ? projectedResourceCatalog : undefined;
  const displayed = filterSessionResources(resources ?? [], kind, scope, origin, resourceScope)
    .filter((resource) => !excludeIds?.has(resource.id));
  return (
    <SettingsSectionBlock
      actions={<SessionResourceReloadButton />}
      title={title}
      description={description}
    >
      {resourceCatalog?.truncated
        ? <SettingsNotice>{resourceCatalogNotice(resourceCatalog)}</SettingsNotice>
        : null}
      {displayed.length > 0 ? <SettingsRows>{displayed.map((resource) => (
        <SettingsRow
          key={`${resource.kind}-${resource.id}`}
          leading={<span className={styles.resourceStatus} data-status={resource.status} />}
          title={resource.label}
          description={resourceMetadata(resource, scope)}
          value={resourceStatusLabel(resource.status)}
        >
          {resource.path ? <code className={styles.resourcePath} title={resource.path}>{resource.path}</code> : null}
        </SettingsRow>
      ))}</SettingsRows> : resources === undefined ? (
        <SettingsNotice>当前 Pi 会话尚未就绪；请返回工作台打开对话后再查看或重新加载资源。</SettingsNotice>
      ) : resourceCatalog?.truncated ? null : <SettingsNotice>{empty}</SettingsNotice>}
    </SettingsSectionBlock>
  );
}

function resourceCatalogNotice(catalog: NonNullable<ReturnType<typeof selectSessionResourceCatalog>>): string {
  const fieldNotice = catalog.truncatedFields > 0
    ? `，另有 ${catalog.truncatedFields} 个字段已缩短`
    : "";
  return `资源目录过大，当前显示 ${catalog.projectedItems}/${catalog.totalItems} 项${fieldNotice}。Pi 内部已加载资源不受影响。`;
}

export function filterSessionResources(
  resources: readonly ResourceSummary[],
  kind: ResourceSummary["kind"],
  scope: "global" | "project",
  origin?: ResourceSummary["origin"],
  resourceScope?: ResourceSummary["scope"]
): ResourceSummary[] {
  return resources
    .filter((resource) => resource.kind === kind)
    .filter((resource) => origin === undefined || resource.origin === origin)
    .filter((resource) => resourceScope === undefined
      ? scope === "project" || resource.scope === undefined || resource.scope === "user"
      : resource.scope === resourceScope)
    .sort(compareResources);
}

function compareResources(left: ResourceSummary, right: ResourceSummary): number {
  return resourceScopeRank(left.scope) - resourceScopeRank(right.scope)
    || left.label.localeCompare(right.label, "zh-CN");
}

function resourceScopeRank(scope: ResourceSummary["scope"]): number {
  if (scope === "project") return 0;
  if (scope === "temporary") return 1;
  if (scope === "user") return 2;
  return 3;
}

function resourceMetadata(resource: ResourceSummary, selectedScope: "global" | "project"): string {
  const scope = resource.scope === "project"
    ? "当前项目"
    : resource.scope === "temporary"
      ? "当前会话"
      : resource.scope === "user"
        ? selectedScope === "project" ? "继承自全局" : "全局"
        : "作用域未知";
  const origin = resource.origin === "package"
    ? "来自扩展包"
    : resource.origin === "top-level"
      ? "独立配置"
      : undefined;
  const source = resource.source
    && resource.source !== resource.path
    && !["auto", "local", "path"].includes(resource.source)
    ? resource.source
    : undefined;
  return [scope, origin, source, resource.detail].filter(Boolean).join(" · ");
}

function resourceStatusLabel(status: ResourceSummary["status"]): string {
  if (status === "ready") return "已加载";
  if (status === "failed") return "失败";
  if (status === "tui-only") return "仅终端";
  return "部分可用";
}
