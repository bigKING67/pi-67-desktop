import type { DesktopBundledSkillSuiteSummary } from "@pi67/domain";
import { ChevronRight, FolderOpen, Globe2, Layers3, RefreshCw, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { useDesktopCapabilitySnapshot } from "./DesktopCapabilityPanels.js";
import { SessionResourcePanel } from "./SessionResourcePanel.js";
import {
  SettingsBackAction,
  SettingsCatalog,
  SettingsCatalogRow,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./SkillSettingsWorkspace.module.css";

type CapabilityState = ReturnType<typeof useDesktopCapabilitySnapshot>;

export function SkillSettingsWorkspace() {
  const capability = useDesktopCapabilitySnapshot();
  return (
    <Tabs className={styles.workspace!} defaultSelectedKey="global" data-testid="skill-settings-workspace">
      <TabList aria-label="技能来源分类" className={styles.tabList!}>
        <Tab className={styles.tab!} id="global">
          <Globe2 aria-hidden="true" size={15} />全局技能
        </Tab>
        <Tab className={styles.tab!} id="project">
          <FolderOpen aria-hidden="true" size={15} />项目技能
        </Tab>
        <Tab className={styles.tab!} id="bundled">
          <Sparkles aria-hidden="true" size={15} />内置技能
        </Tab>
      </TabList>
      <TabPanel className={styles.tabPanel!} id="global">
        <SessionResourcePanel
          kind="skill"
          origin="top-level"
          resourceScope="user"
          scope="global"
          title="全局技能"
          description="由用户在本机维护并适用于所有项目；这里只显示 Pi 已解析的独立技能，扩展包技能不会重复出现。"
          empty="尚未发现全局技能。可以将技能放入 ~/.agents/skills 或 ~/.pi/agent/skills。"
        />
      </TabPanel>
      <TabPanel className={styles.tabPanel!} id="project">
        <ProjectSkillPanel />
      </TabPanel>
      <TabPanel className={styles.tabPanel!} id="bundled">
        <BundledSkillPanel capability={capability} />
      </TabPanel>
    </Tabs>
  );
}

function ProjectSkillPanel() {
  const currentWorkspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const workspace = useWorkbenchStore((state) => (
    currentWorkspaceId ? state.workspaces[currentWorkspaceId] : undefined
  ));
  if (!workspace) {
    return (
      <SettingsSectionBlock
        title="项目技能"
        description="由当前项目维护，只在该项目受信任且 Pi 完成资源解析后显示。"
      >
        <SettingsNotice>请先选择一个项目，再查看项目技能。</SettingsNotice>
      </SettingsSectionBlock>
    );
  }
  if (workspace.availability !== "available") {
    return (
      <SettingsSectionBlock
        title="项目技能"
        description="由当前项目维护，只在该项目受信任且 Pi 完成资源解析后显示。"
      >
        <SettingsNotice tone="danger">当前项目目录不可用，无法验证或加载项目技能。</SettingsNotice>
      </SettingsSectionBlock>
    );
  }
  if (workspace.trust !== "trusted") {
    return (
      <SettingsSectionBlock
        title="项目技能"
        description="由当前项目维护，只在该项目受信任且 Pi 完成资源解析后显示。"
      >
        <SettingsNotice tone="warning">
          当前项目尚未受信任。为避免执行未经确认的项目资源，Pi 不会加载项目技能。
        </SettingsNotice>
      </SettingsSectionBlock>
    );
  }
  return (
    <SessionResourcePanel
      kind="skill"
      origin="top-level"
      resourceScope="project"
      scope="project"
      title="项目技能"
      description={`由当前项目 ${workspace.displayName} 维护；这里只显示项目自己的技能，不重复展示全局或扩展包技能。`}
      empty="尚未发现项目技能。可以将技能放入当前项目的 .agents/skills 或 .pi/skills。"
    />
  );
}

function BundledSkillPanel({ capability }: { capability: CapabilityState }) {
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>();
  const [query, setQuery] = useState("");
  const suites = capability.snapshot?.bundledSkillSuites ?? [];
  const selectedSuite = suites.find((suite) => suite.id === selectedSuiteId);
  if (selectedSuite) {
    return (
      <BundledSkillSuiteDetail
        query={query}
        suite={selectedSuite}
        onBack={() => {
          setSelectedSuiteId(undefined);
          setQuery("");
        }}
        onQueryChange={setQuery}
      />
    );
  }
  const skillCount = suites.reduce((total, suite) => total + suite.skills.length, 0);
  return (
    <SettingsSectionBlock
      actions={<Button
        className="secondary-button"
        isDisabled={capability.phase === "loading"}
        onPress={() => void capability.refresh()}
      >
        <RefreshCw aria-hidden="true" size={14} />
        {capability.phase === "loading" ? "刷新中…" : "刷新状态"}
      </Button>}
      title="内置技能套件"
      description={suites.length > 0
        ? `${suites.length} 个技能套件，共 ${skillCount} 个技能；随 Pi-67 Desktop 发布并跟随应用更新。`
        : "随 Pi-67 Desktop 发布并跟随应用更新；不通过第三方扩展包单独安装、更新或卸载。"}
    >
      {capability.error ? <SettingsNotice tone="danger">{capability.error}</SettingsNotice> : null}
      {suites.length > 0 ? <SettingsCatalog label="内置技能套件">{suites.map((suite) => {
        const status = suiteStatus(suite);
        return (
          <SettingsCatalogRow
            key={suite.id}
            description={suite.description}
            leading={<span className={styles.suiteIcon} data-status={status.id}>
              <Layers3 aria-hidden="true" size={16} />
            </span>}
            meta={`${suite.skills.length} 个技能 · ${suiteSourceSummary(suite)}`}
            onSelect={() => {
              setSelectedSuiteId(suite.id);
              setQuery("");
            }}
            testId="bundled-skill-suite-row"
            title={suite.displayName}
            trailing={<span className={styles.suiteTrailing}>
              <span>{status.label}</span><ChevronRight aria-hidden="true" size={15} />
            </span>}
          />
        );
      })}</SettingsCatalog> : (
        <SettingsNotice>
          {capability.snapshot === undefined || capability.phase === "loading"
            ? "正在读取 Pi-67 Desktop 内置技能套件…"
            : "当前版本没有可显示的内置技能套件。"}
        </SettingsNotice>
      )}
      <SettingsNotice className={styles.scopeNotice!}>
        这里表示 Desktop 已随应用提供该技能；当前任务最终使用哪个同名技能，以 Pi 的资源解析结果为准。
      </SettingsNotice>
    </SettingsSectionBlock>
  );
}

function BundledSkillSuiteDetail({ suite, query, onBack, onQueryChange }: {
  suite: DesktopBundledSkillSuiteSummary;
  query: string;
  onBack: () => void;
  onQueryChange: (query: string) => void;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const skills = useMemo(() => suite.skills.filter((skill) => (
    !normalizedQuery
    || [skill.displayName, skill.description, skill.packageDisplayName]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
  )), [normalizedQuery, suite.skills]);
  const status = suiteStatus(suite);
  return (
    <div className={styles.suiteDetail!} data-testid="bundled-skill-suite-detail">
      <SettingsBackAction label="返回内置技能套件" onPress={onBack}>返回内置技能</SettingsBackAction>
      <SettingsSectionBlock
        actions={<span className={styles.detailStatus} data-status={status.id}>{status.label}</span>}
        title={suite.displayName}
        description={`${suite.skills.length} 个技能 · ${suiteSourceSummary(suite)} · 跟随 Pi-67 Desktop 更新`}
      >
        <label className={styles.skillSearch!}>
          <Search aria-hidden="true" size={15} />
          <input
            aria-label={`搜索 ${suite.displayName} 技能`}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="搜索技能名称、用途或来源"
            type="search"
            value={query}
          />
        </label>
        {skills.length > 0 ? <SettingsRows className={styles.skillRows!}>{skills.map((skill) => (
          <SettingsRow
            key={`${skill.packageId}:${skill.id}`}
            title={skill.displayName}
            description={skillPurpose(skill.description)}
            value={skill.installed ? undefined : "准备中"}
          >
            <span className={styles.skillMeta}>{skill.packageDisplayName} · {skill.version}</span>
          </SettingsRow>
        ))}</SettingsRows> : (
          <SettingsNotice className={styles.emptyResult!}>没有匹配的内置技能。</SettingsNotice>
        )}
        <SettingsNotice className={styles.scopeNotice!}>
          套件表示 Desktop 的内置技能分组；当前任务最终使用哪个同名技能，以 Pi 的资源解析结果为准。
        </SettingsNotice>
      </SettingsSectionBlock>
    </div>
  );
}

function suiteStatus(suite: DesktopBundledSkillSuiteSummary): {
  id: "ready" | "partial" | "unavailable";
  label: string;
} {
  const installedCount = suite.skills.filter((skill) => skill.installed).length;
  if (installedCount === suite.skills.length) return { id: "ready", label: "已提供" };
  if (installedCount > 0) return { id: "partial", label: "部分准备" };
  return { id: "unavailable", label: "准备中" };
}

function suiteSourceSummary(suite: DesktopBundledSkillSuiteSummary): string {
  const sources = new Set(suite.skills.map((skill) => `${skill.packageDisplayName} ${skill.version}`));
  return sources.size === 1 ? [...sources][0]! : `${sources.size} 个内置来源`;
}

function skillPurpose(description: string): string {
  const normalized = description.replace(/\s+/gu, " ").trim();
  const chineseStop = normalized.indexOf("。");
  const englishStop = normalized.indexOf(". ");
  const stop = [
    chineseStop >= 0 ? chineseStop + 1 : Number.POSITIVE_INFINITY,
    englishStop >= 0 ? englishStop + 1 : Number.POSITIVE_INFINITY,
    180
  ].reduce((shortest, candidate) => Math.min(shortest, candidate));
  return normalized.length > stop ? `${normalized.slice(0, stop).trim()}…` : normalized;
}
