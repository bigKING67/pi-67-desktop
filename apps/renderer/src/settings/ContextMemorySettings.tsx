import { newMoneyErrorMessage } from "../context-memory/new-money-error-message.js";
import type {
  ContextMemoryConfiguration,
  EnterpriseProjectSummary,
  EnterpriseTeamSummary,
  MemoryPrivacyMode
} from "@pi67/domain";
import { BrainCircuit, Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Radio,
  RadioGroup,
  Tab,
  TabList,
  TabPanel,
  Tabs
} from "react-aria-components";
import {
  bindEnterpriseWorkspace,
  loadEnterpriseProjects,
  loadEnterpriseTeams,
  loadEnterpriseWorkspaceBinding,
  loadContextMemoryOverview,
  runContextMemoryDoctor,
  saveContextMemoryConfiguration,
  selectEnterpriseProjectId,
  type ContextMemoryOverview
} from "../context-memory/context-memory-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore, useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  SettingsNotice,
  SettingsPageHeader,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./ContextMemorySettings.module.css";
import tabStyles from "./SettingsPrimitives.module.css";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";
import { messages } from "../localization/message-catalog.js";
import { LocalMemoryModelSettings } from "./LocalMemoryModelSettings.js";
import { LegacyMemoryServiceSettings } from "./LegacyMemoryServiceSettings.js";
import { SharedKnowledgeSyncSettings } from "./SharedKnowledgeSyncSettings.js";
import {
  bindingLabel,
  configurationChanged,
  EnterpriseProjectSelect,
  EnterpriseTeamSelect,
  healthLabel,
  identityLabel,
  ownerLabel
} from "./ContextMemorySettingsPresentation.js";
import { useNewMoneyAccount } from "../context-memory/use-new-money-account.js";
const PRIVACY_MODES: Array<{ id: MemoryPrivacyMode; label: string; detail: string }> = [
  { id: "private-learning", label: "私人学习", detail: "使用并保存私人记忆，不生成团队候选。" },
  { id: "full-learning", label: "完整学习", detail: "私人学习，并允许生成脱敏的团队经验候选；仍需审核后发布。" },
  { id: "read-only", label: "只读记忆", detail: "使用已有记忆，不保存新记忆。" },
  { id: "off", label: "完全关闭", detail: "不使用或保存记忆，不生成候选。" }
];

export function ContextMemorySettings() {
  const workspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const [overview, setOverview] = useState<ContextMemoryOverview>();
  const [legacyChecked, setLegacyChecked] = useState(false);
  const [draft, setDraft] = useState<ContextMemoryConfiguration>();
  const account = useNewMoneyAccount();
  const [teams, setTeams] = useState<EnterpriseTeamSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>();
  const [projects, setProjects] = useState<EnterpriseProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [busy, setBusy] = useState<"load" | "save" | "doctor" | "auth" | "bind">();
  const [error, setError] = useState<string>();
  const [modelPending, setModelPending] = useState(false);
  const refresh = async (): Promise<void> => {
    setBusy("load");
    setError(undefined);
    try {
      const next = await loadContextMemoryOverview(workspaceId, false);
      setLegacyChecked(false);
      setOverview(next);
      setDraft(next.configuration);
      if (next.identity.state === "signed-in") {
        const nextTeams = await loadEnterpriseTeams();
        const nextTeamId = nextTeams.some((team) => team.id === next.identity.accountId)
          ? next.identity.accountId
          : nextTeams[0]?.id;
        setTeams(nextTeams);
        setSelectedTeamId(nextTeamId);
        if (!nextTeamId) {
          setProjects([]);
          setSelectedProjectId(undefined);
          return;
        }
        const [nextProjects, binding] = await Promise.all([
          loadEnterpriseProjects(nextTeamId),
          workspaceId
            ? loadEnterpriseWorkspaceBinding(workspaceId, nextTeamId)
            : Promise.resolve(undefined)
        ]);
        setProjects(nextProjects);
        setOverview({ ...next, ...(binding === undefined ? {} : { binding }) });
        setSelectedProjectId(
          binding?.enterpriseProjectId
          ?? nextProjects.find((project) => project.status === "active")?.id
        );
      } else {
        setTeams([]);
        setSelectedTeamId(undefined);
        setProjects([]);
        setSelectedProjectId(undefined);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取上下文与记忆状态。");
    } finally {
      setBusy(undefined);
    }
  };

  useEffect(() => { void refresh(); }, [workspaceId, account.identity?.state, account.identity?.userId]);


  const save = async (): Promise<void> => {
    if (!draft) return;
    setBusy("save");
    setError(undefined);
    try {
      const saved = await saveContextMemoryConfiguration({
        expectedRevision: draft.revision,
        enabled: draft.enabled,
        endpoint: draft.endpoint,
        enterpriseGatewayEndpoint: draft.enterpriseGatewayEndpoint,
        defaultPrivacyMode: draft.defaultPrivacyMode,
        recallTokenBudget: draft.recallTokenBudget,
        scoreThreshold: draft.scoreThreshold,
        commitTokenThreshold: draft.commitTokenThreshold,
        captureAssistantTurns: draft.captureAssistantTurns,
        privateExperienceLimit: draft.privateExperienceLimit,
        localResourceRecallLimit: draft.localResourceRecallLimit,
        sharedExperienceLimit: draft.sharedExperienceLimit,
        takeover: draft.takeover
      });
      setDraft(saved);
      setOverview((current) => current ? { ...current, configuration: saved } : current);
      publishNotification({
        level: "success",
        title: "上下文与记忆设置已保存",
        message: "只读或关闭会在当前会话的下一次处理边界生效；重新开放学习或更换服务需要新建会话。"
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setBusy(undefined);
    }
  };
  const bindWorkspace = async (): Promise<void> => {
    if (!workspaceId || !selectedTeamId || !selectedProjectId) return;
    setBusy("bind");
    setError(undefined);
    try {
      const binding = await bindEnterpriseWorkspace(workspaceId, selectedTeamId, selectedProjectId);
      setOverview((current) => current ? { ...current, binding } : current);
      publishNotification({ level: "success", title: "工作区已绑定", message: "完整学习模式下的脱敏候选可以提交团队审核。" });
    } catch (cause) {
      setError(newMoneyErrorMessage(cause, "工作区绑定失败。"));
    } finally {
      setBusy(undefined);
    }
  };
  const selectTeam = async (teamId: string | undefined): Promise<void> => {
    const currentOverview = overview;
    setSelectedTeamId(teamId);
    setSelectedProjectId(undefined);
    setProjects([]);
    if (!teamId || !currentOverview) return;
    setBusy("load");
    setError(undefined);
    try {
      const [nextProjects, binding] = await Promise.all([
        loadEnterpriseProjects(teamId),
        workspaceId
          ? loadEnterpriseWorkspaceBinding(workspaceId, teamId)
          : Promise.resolve(undefined)
      ]);
      setProjects(nextProjects);
      const context: ContextMemoryOverview = {
        ...currentOverview,
        ...(binding === undefined ? {} : { binding })
      };
      setOverview(context);
      setSelectedProjectId(selectEnterpriseProjectId(context, nextProjects));
    } catch (cause) {
      setError(newMoneyErrorMessage(cause, "无法读取 New Money 团队。"));
    } finally {
      setBusy(undefined);
    }
  };
  const doctor = async (): Promise<void> => {
    setBusy("doctor");
    try {
      const result = await runContextMemoryDoctor();
      setLegacyChecked(true);
      setOverview((current) => current ? { ...current, status: result.status, configuration: result.effectiveConfiguration } : current);
      setDraft(result.effectiveConfiguration);
      publishNotification({
        level: result.status.health === "healthy" ? "success" : "warning",
        title: result.status.health === "healthy" ? "手动服务地址连接正常" : "手动服务地址检测未通过",
        message: result.status.detail ?? `当前状态：${healthLabel(result.status.health)}`
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "诊断失败。");
    } finally {
      setBusy(undefined);
    }
  };

  const changed = !!draft && !!overview && configurationChanged(draft, overview.configuration);
  useSettingsDraftRegistration({
    dirty: changed,
    busy: busy !== undefined,
    subject: "上下文与记忆设置",
    discard: () => setDraft(overview?.configuration)
  });

  if (!draft || !overview) {
    return <div className={styles.workspace}><SettingsPageHeader title={messages.settings.sections.contextMemory.label} description={messages.settings.sections.contextMemory.summary} /><SettingsNotice tone={error ? "danger" : "info"}>{error ?? "正在读取记忆设置…"}</SettingsNotice></div>;
  }

  return <div className={styles.workspace} data-testid="context-memory-settings">
    <SettingsPageHeader
      title={messages.settings.sections.contextMemory.label}
      description={messages.settings.sections.contextMemory.summary}
      actions={<Button className="primary-button" isDisabled={!changed || busy !== undefined} onPress={() => void save()}>{busy === "save" ? "正在保存…" : "保存更改"}</Button>}
    />
    {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
    {overview.status.conflictExtensions.length > 0 ? <SettingsNotice tone="danger">
      检测到冲突的记忆扩展：{overview.status.conflictExtensions.join("、")}。这些扩展已停止加载；对话仍可继续，已有记忆不会删除。
    </SettingsNotice> : null}
    <Tabs className={styles.tabs!} defaultSelectedKey="privacy">
      <TabList aria-label="上下文与记忆设置" className={tabStyles.tabList!}>
        <Tab className={tabStyles.tab!} id="privacy">记忆与隐私</Tab>
        <Tab className={tabStyles.tab!} id="enterprise" isDisabled={modelPending}>团队经验</Tab>
        <Tab className={tabStyles.tab!} id="advanced" isDisabled={modelPending}>高级</Tab>
      </TabList>
      <TabPanel className={tabStyles.tabPanel!} id="privacy">
        <SettingsSectionBlock title="记忆模式" description="选择默认的记忆使用方式。私人记忆保持独立，团队候选不会自动发布。">
          <RadioGroup aria-label="默认记忆模式" className={styles.privacyGroup!} value={draft.defaultPrivacyMode} isDisabled={busy !== undefined}
            onChange={(value) => {
              const mode = PRIVACY_MODES.find((item) => item.id === value);
              if (mode) setDraft({ ...draft, defaultPrivacyMode: mode.id });
            }}>
            {PRIVACY_MODES.map((mode) => <Radio className={styles.privacyRow!} value={mode.id} key={mode.id}>
              <span aria-hidden="true" className={styles.radioIndicator} />
              <span className={styles.privacyIdentity}><strong>{mode.label}{mode.id === "private-learning" ? <small>默认</small> : null}</strong><span>{mode.detail}</span></span>
            </Radio>)}
          </RadioGroup>
          <p className={styles.note}>保存后，只读或关闭会在当前会话的下一次处理边界生效；重新开启学习需要新建会话。</p>
        </SettingsSectionBlock>
        <LocalMemoryModelSettings onPendingChange={setModelPending} />
      </TabPanel>
      <TabPanel className={tabStyles.tabPanel!} id="enterprise">
    <SettingsSectionBlock title="New Money" description="登录只增加团队共享召回和候选提交流程，不会上传本地私人记忆。">
      <SettingsRows>
        <SettingsRow
          leading={<Building2 aria-hidden="true" size={17} />}
          title="New Money 账户"
          description={account.identity?.state === "signed-in"
            ? `${account.identity.displayName ?? account.identity?.userId ?? "New Money 用户"} · 本地私人记忆保持独立`
            : "连接 New Money 后，可选择团队并为当前工作区绑定项目。"}
          value={account.identity ? identityLabel(account.identity.state) : "状态待确认"}
          actions={<Button className="secondary-button" isDisabled={busy !== undefined || changed}
            onPress={() => rendererWorkbenchStore.getState().openSettings("account")}>账户与登录设置</Button>}
        />
        {account.identity?.state === "signed-in" ? <SettingsRow
          title="当前团队"
          description="团队决定成员权限和共享知识边界；账户登录统一在账户与数据中管理。"
          value={teams.find((team) => team.id === selectedTeamId)?.name ?? "未选择"}
          actions={<EnterpriseTeamSelect
            isDisabled={busy !== undefined || teams.length === 0}
            onChange={(value) => void selectTeam(value)}
            teams={teams}
            {...(selectedTeamId === undefined ? {} : { value: selectedTeamId })}
          />}
        /> : null}
        <SettingsRow
          title="当前项目绑定"
          description="只有已登录、可信且明确绑定到当前团队项目的工作区才能提交候选。"
          value={bindingLabel(overview.binding?.state)}
          actions={account.identity?.state === "signed-in" && overview.binding?.state !== "bound" ? <div className={styles.bindingActions}>
            <EnterpriseProjectSelect
              isDisabled={busy !== undefined || projects.length === 0}
              onChange={setSelectedProjectId}
              projects={projects}
              {...(selectedProjectId === undefined ? {} : { value: selectedProjectId })}
            />
            <Button
              className="primary-button"
              isDisabled={!workspaceId || !selectedTeamId || !selectedProjectId || busy !== undefined}
              onPress={() => void bindWorkspace()}
            >绑定</Button>
          </div> : undefined}
        />
        <SettingsRow title="发布策略" description="本机抽取 → 证据校验 → 脱敏 → 团队审核 → OpenViking 共享资源；从不自动发布。" value="审核后发布" />
      </SettingsRows>
      {account.identity?.state === "signed-out" ? <SettingsNotice tone="info">New Money 尚未连接；本地 Desktop、私人记忆和私人经验仍可免费独立使用。</SettingsNotice> : null}
      {changed && draft.enterpriseGatewayEndpoint ? <SettingsNotice tone="warning">请先保存当前记忆设置，再前往账户与数据管理登录。</SettingsNotice> : null}
      {account.identity?.state === "signed-in" && selectedTeamId && !changed && !busy && !modelPending ? <SharedKnowledgeSyncSettings
        key={`${workspaceId}:${overview.configuration.enterpriseGatewayEndpoint}:${account.identity?.userId}:${selectedTeamId}:${overview.binding?.enterpriseProjectId ?? ""}`}
        teamId={selectedTeamId} {...(overview.binding?.state === "bound" && overview.binding.accountId === selectedTeamId && overview.binding.enterpriseProjectId ? { projectId: overview.binding.enterpriseProjectId } : {})}
      /> : null}
    </SettingsSectionBlock>
      </TabPanel>
      <TabPanel className={tabStyles.tabPanel!} id="advanced">
        <LegacyMemoryServiceSettings status={overview.status} endpoint={draft.endpoint} checked={legacyChecked}
          checking={busy === "doctor"} busy={busy !== undefined} changed={changed} onCheck={() => void doctor()}
          onEndpointChange={(endpoint) => { setLegacyChecked(false); setDraft({ ...draft, endpoint }); }} />
    <SettingsSectionBlock title="上下文参数" description="查看当前配置的归档与召回参数。当前会话的状态和手动归档位于工作台的记忆面板。">
      <SettingsRows>
        <SettingsRow title="上下文引擎" description="在会话创建时确定，变更后需要新建会话。" value={ownerLabel(overview.status.owner)} />
        <SettingsRow leading={<BrainCircuit aria-hidden="true" size={17} />} title="上下文接管" description={`达到 ${draft.takeover.tokenThreshold.toLocaleString()} Token 后归档，保留最近 ${draft.takeover.keepRecentTurns} 轮对话。`} value={draft.takeover.enabled ? "开启" : "关闭"} />
        <SettingsRow title="归档阈值" description="达到阈值后由 Pi 扩展排队归档；失败时保留本地上下文。" value={`${draft.commitTokenThreshold.toLocaleString()} Token`} />
        <SettingsRow title="单次召回预算" description={`符合检索条件的当前提示词自动召回最多 ${draft.recallTokenBudget.toLocaleString()} Token；信息仍不足时才按需搜索和深读。私人经验 ${draft.privateExperienceLimit} 条、本地资源 ${draft.localResourceRecallLimit} 条、团队经验 ${draft.sharedExperienceLimit} 条。`} value={`${draft.recallTokenBudget.toLocaleString()} Token`} />
      </SettingsRows>
    </SettingsSectionBlock>

        <details className={styles.details}>
          <summary>生效规则与安全边界</summary>
          <p>只读和关闭会在当前会话的下一次 Pi 生命周期或 OpenViking 工具边界生效。重新开放学习、变更上下文引擎或服务地址，需要新建会话。</p>
          <p>Pi JSONL 始终是会话事实源。记忆以不可信上下文提供，不能授权 Shell、文件或外部操作。远程服务必须使用 HTTPS；HTTP 仅允许 127.0.0.1 / localhost。</p>
        </details>
      </TabPanel>
    </Tabs>
  </div>;
}
