import type { SkillPackEntry } from "@pi67/domain";
import {
  ChevronRight,
  FolderOpen,
  Globe2,
  Layers3,
  RefreshCw
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Tab,
  TabList,
  TabPanel,
  Tabs
} from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  BundledSkillSuiteDetail,
  suiteStatus,
  suiteVersionSummary
} from "./BundledSkillSuiteDetail.js";
import { useDesktopCapabilitySnapshot } from "./DesktopCapabilityPanels.js";
import {
  ManagedGlobalSkillPanel,
  SkillPackMutationDialog,
  type SkillPackMutationAction
} from "./ManagedGlobalSkillPanel.js";
import { SessionResourcePanel } from "./SessionResourcePanel.js";
import {
  checkSkillPackUpdates,
  installSkillPack,
  loadSkillPacks,
  restoreSkillPack,
  updateSkillPack
} from "./skill-pack-controller.js";
import { useSkillPackStore } from "./skill-pack-store.js";
import {
  SettingsCatalog,
  SettingsCatalogRow,
  SettingsNotice,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./SkillSettingsWorkspace.module.css";

type CapabilityState = ReturnType<typeof useDesktopCapabilitySnapshot>;
type GlobalSkillSelection =
  | { kind: "bundled"; id: string }
  | { kind: "managed"; id: string };

export function SkillSettingsWorkspace() {
  const capability = useDesktopCapabilitySnapshot();
  return (
    <Tabs className={styles.workspace!} defaultSelectedKey="global" data-testid="skill-settings-workspace">
      <TabList aria-label="技能可用范围" className={styles.tabList!}>
        <Tab className={styles.tab!} id="global">
          <Globe2 aria-hidden="true" size={15} />全局可用
        </Tab>
        <Tab className={styles.tab!} id="project">
          <FolderOpen aria-hidden="true" size={15} />项目专属
        </Tab>
      </TabList>
      <TabPanel className={styles.tabPanel!} id="global">
        <GlobalSkillPanel capability={capability} />
      </TabPanel>
      <TabPanel className={styles.tabPanel!} id="project">
        <ProjectSkillPanel />
      </TabPanel>
    </Tabs>
  );
}

function GlobalSkillPanel({ capability }: { capability: CapabilityState }) {
  const [selection, setSelection] = useState<GlobalSkillSelection>();
  const bundledSuiteIds = useMemo(() => new Set(
    capability.snapshot?.bundledSkillSuites.map((suite) => suite.id) ?? []
  ), [capability.snapshot?.bundledSkillSuites]);
  if (selection?.kind === "bundled") {
    return (
      <BundledSkillPanel
        capability={capability}
        selectedSuiteId={selection.id}
        onBack={() => setSelection(undefined)}
        onSelectSuite={(id) => setSelection({ kind: "bundled", id })}
      />
    );
  }
  if (selection?.kind === "managed") {
    return (
      <ManagedGlobalSkillPanel
        excludedSuiteIds={bundledSuiteIds}
        selectedPackId={selection.id}
        onBack={() => setSelection(undefined)}
        onSelectPack={(id) => setSelection({ kind: "managed", id })}
      />
    );
  }
  return (
    <div className={styles.globalSkills}>
      <BundledSkillPanel
        capability={capability}
        onBack={() => setSelection(undefined)}
        onSelectSuite={(id) => setSelection({ kind: "bundled", id })}
      />
      <ManagedGlobalSkillPanel
        excludedSuiteIds={bundledSuiteIds}
        onBack={() => setSelection(undefined)}
        onSelectPack={(id) => setSelection({ kind: "managed", id })}
      />
    </div>
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

function BundledSkillPanel({ capability, selectedSuiteId, onBack, onSelectSuite }: {
  capability: CapabilityState;
  selectedSuiteId?: string;
  onBack: () => void;
  onSelectSuite: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{ action: SkillPackMutationAction; pack: SkillPackEntry }>();
  const settingsWorkspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId);
  const currentWorkspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const workspaceId = settingsWorkspaceId ?? currentWorkspaceId;
  const { items: managedPacks, phase, error, workspaceId: loadedWorkspaceId } = useSkillPackStore();
  const suites = capability.snapshot?.bundledSkillSuites ?? [];
  const selectedSuite = suites.find((suite) => suite.id === selectedSuiteId);
  const managedBySuiteId = useMemo(() => new Map(
    managedPacks.map((pack) => [pack.suiteId, pack])
  ), [managedPacks]);
  const busy = phase === "loading"
    || phase === "checking"
    || phase === "installing"
    || phase === "updating"
    || phase === "restoring";
  const updateCount = suites.filter((suite) => (
    managedBySuiteId.get(suite.id)?.updateStatus === "update-available"
  )).length;

  useEffect(() => {
    if (!workspaceId) useSkillPackStore.getState().reset();
    else if (loadedWorkspaceId !== workspaceId) void loadSkillPacks(workspaceId);
  }, [loadedWorkspaceId, workspaceId]);

  if (selectedSuite) {
    const pack = managedBySuiteId.get(selectedSuite.id);
    return (
      <>
        <BundledSkillSuiteDetail
          busy={busy}
          {...(pack ? { pack } : {})}
          query={query}
          suite={selectedSuite}
          onBack={() => {
            setQuery("");
            onBack();
          }}
          onMutation={(action, target) => setPending({ action, pack: target })}
          onQueryChange={setQuery}
        />
        {pending ? <SkillPackMutationDialog
          action={pending.action}
          busy={phase === "installing" || phase === "updating" || phase === "restoring"}
          error={phase === "failed" ? error : undefined}
          pack={pending.pack}
          onCancel={() => setPending(undefined)}
          onConfirm={async () => {
            const completed = pending.action === "install"
              ? await installSkillPack(pending.pack.id, workspaceId)
              : pending.action === "update"
                ? await updateSkillPack(pending.pack.id, workspaceId)
                : await restoreSkillPack(pending.pack.id, workspaceId);
            if (completed) setPending(undefined);
          }}
        /> : null}
      </>
    );
  }
  const skillCount = suites.reduce((total, suite) => total + suite.skills.length, 0);
  return (
    <SettingsSectionBlock
      actions={<span className={styles.detailActions}>
        <Button
          className="secondary-button"
          isDisabled={!workspaceId || busy}
          onPress={() => void checkSkillPackUpdates(workspaceId)}
        >
          <RefreshCw
            aria-hidden="true"
            className={phase === "checking" ? styles.spinning : undefined}
            size={14}
          />
          {phase === "checking" ? "检查中…" : updateCount > 0 ? `更新可用 ${updateCount}` : "检查技能更新"}
        </Button>
        <Button
          className="secondary-button"
          isDisabled={capability.phase === "loading"}
          onPress={() => void capability.refresh()}
        >
          <RefreshCw aria-hidden="true" size={14} />
          {capability.phase === "loading" ? "刷新中…" : "刷新状态"}
        </Button>
      </span>}
      title="内置技能套件"
      description={suites.length > 0
        ? `${suites.length} 个技能套件，共 ${skillCount} 个技能；随 Desktop 提供并对所有项目可用。`
        : "随 Pi-67 Desktop 提供并对所有项目可用；不通过第三方扩展包重复安装。"}
    >
      {capability.error ? <SettingsNotice tone="danger">{capability.error}</SettingsNotice> : null}
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
      {suites.length > 0 ? <SettingsCatalog label="内置技能套件">{suites.map((suite) => {
        const pack = managedBySuiteId.get(suite.id);
        const status = suiteStatus(suite, pack);
        return (
          <SettingsCatalogRow
            key={suite.id}
            description={suite.description}
            leading={<span className={styles.suiteIcon} data-status={status.id}>
              <Layers3 aria-hidden="true" size={16} />
            </span>}
            meta={`${pack?.skillIds.length ?? suite.skills.length} 个技能 · ${suiteVersionSummary(suite, pack)}`}
            onSelect={() => {
              setQuery("");
              onSelectSuite(suite.id);
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
        内置技能对所有项目可用并由 Desktop 管理；当前任务最终使用哪个同名技能，以 Pi 的资源解析结果为准。
      </SettingsNotice>
    </SettingsSectionBlock>
  );
}
