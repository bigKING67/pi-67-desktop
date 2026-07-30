import type { ResourceSummary } from "@pi67/domain";
import { RefreshCw } from "lucide-react";
import { Button } from "react-aria-components";
import { reloadSessionResources } from "../session/session-control-controller.js";
import { selectSessionResources } from "../session/session-projection-selectors.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import styles from "./SettingsWorkbench.module.css";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";

export function SessionResourcePanel({ kind, origin, resourceScope, scope: requestedScope, title, description, empty }: {
  kind: ResourceSummary["kind"];
  origin?: ResourceSummary["origin"];
  resourceScope?: ResourceSummary["scope"];
  scope?: "global" | "project";
  title: string;
  description: string;
  empty: string;
}) {
  const settingsScope = useWorkbenchStore((state) => state.settingsScope);
  const scope = requestedScope ?? settingsScope;
  const resources = useSessionProjectionStore(selectSessionResources);
  const displayed = filterSessionResources(resources ?? [], kind, scope, origin, resourceScope);
  return (
    <SettingsSectionBlock
      actions={<Button className="secondary-button" onPress={() => void reloadSessionResources()}>
        <RefreshCw aria-hidden="true" size={14} />重新加载
      </Button>}
      title={title}
      description={description}
    >
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
      ))}</SettingsRows> : (
        <SettingsNotice>{resources === undefined ? "当前任务尚未同步可显示的 Pi 资源。" : empty}</SettingsNotice>
      )}
    </SettingsSectionBlock>
  );
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
