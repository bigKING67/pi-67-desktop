import type {
  ContextMemoryConfiguration,
  EnterpriseProjectSummary,
  MemoryPrivacyMode
} from "@pi67/domain";
import type { EnterpriseDeviceAuthorization } from "@pi67/protocol";
import { BrainCircuit, Building2, ChevronDown, Database, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  Radio,
  RadioGroup,
  Tab,
  TabList,
  TabPanel,
  Tabs
} from "react-aria-components";
import {
  beginEnterpriseAuthorization,
  bindEnterpriseWorkspace,
  disconnectEnterpriseAccount,
  loadEnterpriseProjects,
  loadContextMemoryOverview,
  pollEnterpriseAuthorization,
  runContextMemoryDoctor,
  saveContextMemoryConfiguration,
  selectEnterpriseProjectId,
  type ContextMemoryOverview
} from "../context-memory/context-memory-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
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

const PRIVACY_MODES: Array<{ id: MemoryPrivacyMode; label: string; detail: string }> = [
  { id: "private-learning", label: "私人学习", detail: "使用并保存私人记忆，不生成团队候选。" },
  { id: "full-learning", label: "完整学习", detail: "私人学习，并允许生成脱敏的团队经验候选；仍需审核后发布。" },
  { id: "read-only", label: "只读记忆", detail: "使用已有记忆，不保存新记忆。" },
  { id: "off", label: "完全关闭", detail: "不使用或保存记忆，不生成候选。" }
];

export function ContextMemorySettings() {
  const workspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const [overview, setOverview] = useState<ContextMemoryOverview>();
  const [draft, setDraft] = useState<ContextMemoryConfiguration>();
  const [authorization, setAuthorization] = useState<EnterpriseDeviceAuthorization>();
  const [projects, setProjects] = useState<EnterpriseProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [busy, setBusy] = useState<"load" | "save" | "doctor" | "auth" | "bind">();
  const [error, setError] = useState<string>();

  const refresh = async (): Promise<void> => {
    setBusy("load");
    setError(undefined);
    try {
      const next = await loadContextMemoryOverview(workspaceId);
      setOverview(next);
      setDraft(next.configuration);
      if (next.identity.state === "signed-in") {
        const nextProjects = await loadEnterpriseProjects();
        setProjects(nextProjects);
        setSelectedProjectId(
          next.binding?.enterpriseProjectId
          ?? nextProjects.find((project) => project.status === "active")?.id
        );
      } else {
        setProjects([]);
        setSelectedProjectId(undefined);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取上下文与记忆状态。");
    } finally {
      setBusy(undefined);
    }
  };

  useEffect(() => { void refresh(); }, [workspaceId]);

  useEffect(() => {
    if (!authorization) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const identity = await pollEnterpriseAuthorization(authorization.authorizationId);
        if (cancelled) return;
        if (identity.state === "signed-in") {
          const [nextOverview, nextProjects] = await Promise.all([
            loadContextMemoryOverview(workspaceId),
            loadEnterpriseProjects()
          ]);
          if (cancelled) return;
          setOverview(nextOverview);
          setDraft(nextOverview.configuration);
          setProjects(nextProjects);
          setSelectedProjectId(selectEnterpriseProjectId(nextOverview, nextProjects));
          setAuthorization(undefined);
          publishNotification({ level: "success", title: "企业账户已连接", message: "本地私人记忆保持独立；现在可以绑定当前工作区。" });
          return;
        }
        if (identity.state === "expired") {
          setAuthorization(undefined);
          setOverview((current) => current ? { ...current, identity } : current);
          setError("企业授权码已过期，请重新开始登录。");
          return;
        }
        timer = setTimeout(() => void poll(), authorization.intervalSeconds * 1_000);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "企业授权状态检查失败。");
          timer = setTimeout(() => void poll(), authorization.intervalSeconds * 1_000);
        }
      }
    };
    timer = setTimeout(() => void poll(), authorization.intervalSeconds * 1_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authorization]);

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

  const beginEnterprise = async (): Promise<void> => {
    setBusy("auth");
    setError(undefined);
    try {
      const next = await beginEnterpriseAuthorization();
      setAuthorization(next);
      setOverview((current) => current ? {
        ...current,
        identity: { state: "pending", expiresAt: next.expiresAt }
      } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "企业登录未能开始。");
    } finally {
      setBusy(undefined);
    }
  };

  const disconnectEnterprise = async (): Promise<void> => {
    setBusy("auth");
    setError(undefined);
    try {
      const identity = await disconnectEnterpriseAccount();
      setAuthorization(undefined);
      setProjects([]);
      setSelectedProjectId(undefined);
      setOverview((current) => current ? {
        ...current,
        identity,
        ...(workspaceId ? { binding: { state: "unbound", workspaceId } } : {})
      } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "企业账户断开失败。");
    } finally {
      setBusy(undefined);
    }
  };

  const bindWorkspace = async (): Promise<void> => {
    if (!workspaceId || !selectedProjectId) return;
    setBusy("bind");
    setError(undefined);
    try {
      const binding = await bindEnterpriseWorkspace(workspaceId, selectedProjectId);
      setOverview((current) => current ? { ...current, binding } : current);
      publishNotification({ level: "success", title: "工作区已绑定", message: "完整学习模式下的脱敏候选可以提交企业审核。" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作区绑定失败。");
    } finally {
      setBusy(undefined);
    }
  };

  const doctor = async (): Promise<void> => {
    setBusy("doctor");
    try {
      const result = await runContextMemoryDoctor();
      setOverview((current) => current ? { ...current, status: result.status, configuration: result.effectiveConfiguration } : current);
      setDraft(result.effectiveConfiguration);
      publishNotification({
        level: result.status.health === "healthy" ? "success" : "warning",
        title: result.status.health === "healthy" ? "OpenViking 连接正常" : "OpenViking 需要处理",
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
        <Tab className={tabStyles.tab!} id="enterprise">企业经验</Tab>
        <Tab className={tabStyles.tab!} id="advanced">高级</Tab>
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
        <SettingsSectionBlock title="记忆服务" description="使用 OpenViking 管理私人记忆。服务暂时不可用时，对话仍可继续。">
          <SettingsRows>
            <SettingsRow leading={<Database aria-hidden="true" size={17} />} title="OpenViking" value={healthLabel(overview.status.health)}
              actions={<Button className="secondary-button" isDisabled={busy !== undefined || changed} onPress={() => void doctor()}>{busy === "doctor" ? "正在测试…" : "测试连接"}</Button>} />
            <SettingsRow title="服务地址" description="远程连接使用 HTTPS；本机地址支持 HTTP。">
              <Input aria-label="OpenViking 服务地址" className={styles.input!} value={draft.endpoint} disabled={busy !== undefined}
                onChange={(event) => setDraft({ ...draft, endpoint: event.currentTarget.value })} />
            </SettingsRow>
          </SettingsRows>
          {changed ? <p className={styles.note}>有未保存的更改。保存后可测试连接。</p> : null}
          {overview.status.detail ? <p className={styles.note}>{overview.status.detail}</p> : null}
        </SettingsSectionBlock>
      </TabPanel>
      <TabPanel className={tabStyles.tabPanel!} id="enterprise">
    <SettingsSectionBlock title="企业连接" description="登录只增加共享召回和候选提交流程，不会把本地私人记忆改成公开数据。">
      <SettingsRows>
        <SettingsRow title="企业上下文网关" description="远程地址必须使用 HTTPS；本地联调只允许使用本机回环 HTTP 地址。">
          <Input
            aria-label="企业上下文网关地址"
            className={styles.input!}
            placeholder="https://datahub.example.com"
            disabled={busy !== undefined}
            value={draft.enterpriseGatewayEndpoint}
            onChange={(event) => setDraft({ ...draft, enterpriseGatewayEndpoint: event.currentTarget.value })}
          />
        </SettingsRow>
        <SettingsRow
          leading={<Building2 aria-hidden="true" size={17} />}
          title="企业账户"
          description={overview.identity.state === "signed-in"
            ? `${overview.identity.displayName ?? overview.identity.userId ?? "企业用户"} · ${overview.identity.accountId ?? "企业空间"}`
            : "连接企业账户后，可为当前工作区绑定企业项目。"}
          value={identityLabel(overview.identity.state)}
          actions={overview.identity.state === "signed-in" ? <Button
            className="secondary-button"
            isDisabled={busy !== undefined}
            onPress={() => void disconnectEnterprise()}
          >断开连接</Button> : <Button
            className="secondary-button"
            isDisabled={busy !== undefined || changed || !draft.enterpriseGatewayEndpoint}
            onPress={() => void beginEnterprise()}
          >连接企业</Button>}
        />
        <SettingsRow
          title="当前项目绑定"
          description="只有已登录、可信且明确绑定的工作区才能提交经验候选。"
          value={bindingLabel(overview.binding?.state)}
          actions={overview.identity.state === "signed-in" && overview.binding?.state !== "bound" ? <div className={styles.bindingActions}>
            <EnterpriseProjectSelect
              isDisabled={busy !== undefined || projects.length === 0}
              onChange={setSelectedProjectId}
              projects={projects}
              {...(selectedProjectId === undefined ? {} : { value: selectedProjectId })}
            />
            <Button
              className="primary-button"
              isDisabled={!workspaceId || !selectedProjectId || busy !== undefined}
              onPress={() => void bindWorkspace()}
            >绑定</Button>
          </div> : undefined}
        />
        <SettingsRow title="发布策略" description="本机抽取 → 证据校验 → 脱敏 → 企业审核 → 共享资源；从不自动发布。" value="审核后发布" />
      </SettingsRows>
      {authorization ? <SettingsNotice actions={<Button
        className="secondary-button"
        onPress={() => void window.pi67.system.requestOpenExternal(authorization.verificationUri)}
      ><ExternalLink aria-hidden="true" size={14} />打开授权页</Button>}>
        请在 DataHub 登录并确认此设备。验证码：<code>{authorization.userCode}</code>；完成后桌面端会自动刷新。
      </SettingsNotice> : null}
      {overview.identity.state === "signed-out" ? <SettingsNotice tone="info">企业上下文网关尚未连接；本地私人记忆和私人经验不受影响。</SettingsNotice> : null}
      {changed && draft.enterpriseGatewayEndpoint ? <SettingsNotice tone="warning">请先保存网关地址，再连接企业账户。</SettingsNotice> : null}
    </SettingsSectionBlock>
      </TabPanel>
      <TabPanel className={tabStyles.tabPanel!} id="advanced">
    <SettingsSectionBlock title="上下文参数" description="查看当前配置的归档与召回参数。当前会话的状态和手动归档位于工作台的记忆面板。">
      <SettingsRows>
        <SettingsRow title="上下文引擎" description="在会话创建时确定，变更后需要新建会话。" value={ownerLabel(overview.status.owner)} />
        <SettingsRow leading={<BrainCircuit aria-hidden="true" size={17} />} title="上下文接管" description={`达到 ${draft.takeover.tokenThreshold.toLocaleString()} Token 后归档，保留最近 ${draft.takeover.keepRecentTurns} 轮对话。`} value={draft.takeover.enabled ? "开启" : "关闭"} />
        <SettingsRow title="归档阈值" description="达到阈值后由 Pi 扩展排队归档；失败时保留本地上下文。" value={`${draft.commitTokenThreshold.toLocaleString()} Token`} />
        <SettingsRow title="单次召回预算" description={`符合检索条件的当前提示词自动召回最多 ${draft.recallTokenBudget.toLocaleString()} Token；信息仍不足时才按需搜索和深读。私人经验 ${draft.privateExperienceLimit} 条、本地资源 ${draft.localResourceRecallLimit} 条、企业经验 ${draft.sharedExperienceLimit} 条。`} value={`${draft.recallTokenBudget.toLocaleString()} Token`} />
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

function EnterpriseProjectSelect({ projects, value, isDisabled, onChange }: {
  projects: EnterpriseProjectSummary[];
  value?: string;
  isDisabled: boolean;
  onChange: (value: string | undefined) => void;
}) {
  return <Select
    aria-label="企业项目"
    className={styles.projectSelect!}
    isDisabled={isDisabled}
    onSelectionChange={(key) => onChange(key === null ? undefined : String(key))}
    selectedKey={value ?? null}
  >
    <Label className={styles.projectSelectLabel}>企业项目</Label>
    <Button className={styles.projectSelectTrigger!}>
      <span>{projects.find((project) => project.id === value)?.name ?? "选择项目"}</span>
      <ChevronDown aria-hidden="true" size={13} />
    </Button>
    <Popover className={styles.projectSelectPopover!} placement="bottom end">
      <ListBox className={styles.projectSelectList!}>
        {projects.filter((project) => project.status === "active").map((project) => <ListBoxItem
          className={styles.projectSelectOption!}
          id={project.id}
          key={project.id}
          textValue={project.name}
        >
          <strong>{project.name}</strong>
          <small>{project.slug} · {project.sharedAssetCount} 个共享资产</small>
        </ListBoxItem>)}
      </ListBox>
    </Popover>
  </Select>;
}

function configurationChanged(left: ContextMemoryConfiguration, right: ContextMemoryConfiguration): boolean {
  return JSON.stringify({ ...left, revision: undefined }) !== JSON.stringify({ ...right, revision: undefined });
}

function healthLabel(value: ContextMemoryOverview["status"]["health"]): string {
  if (value === "healthy") return "正常";
  if (value === "degraded") return "降级";
  if (value === "conflict") return "冲突停用";
  if (value === "disabled") return "已关闭";
  return "不可用";
}

function ownerLabel(value: ContextMemoryOverview["status"]["owner"]): string {
  if (value === "pi67-openviking") return "OpenViking";
  if (value === "pi-default-compaction") return "Pi 默认回退";
  return "无";
}

function identityLabel(value: ContextMemoryOverview["identity"]["state"]): string {
  if (value === "signed-in") return "已登录";
  if (value === "pending") return "等待授权";
  if (value === "expired") return "已过期";
  return "本地模式";
}

function bindingLabel(value: NonNullable<ContextMemoryOverview["binding"]>["state"] | undefined): string {
  if (value === "bound") return "已绑定";
  if (value === "pending") return "待确认";
  if (value === "revoked") return "已撤销";
  return "未绑定";
}
