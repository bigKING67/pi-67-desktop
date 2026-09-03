import type {
  ContextMemoryConfiguration,
  EnterpriseProjectSummary,
  MemoryPrivacyMode
} from "@pi67/domain";
import type { EnterpriseDeviceAuthorization } from "@pi67/protocol";
import { BrainCircuit, Building2, ChevronDown, Database, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select
} from "react-aria-components";
import {
  beginEnterpriseAuthorization,
  bindEnterpriseWorkspace,
  commitContextSession,
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
import { selectSessionId } from "../session/session-projection-selectors.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./ContextMemorySettings.module.css";

const PRIVACY_MODES: Array<{ id: MemoryPrivacyMode; label: string; detail: string }> = [
  { id: "full-learning", label: "完整学习", detail: "私人学习，并允许生成脱敏的团队经验候选；仍需审核后发布。" },
  { id: "private-learning", label: "私人学习", detail: "召回并写入本地私人记忆，不生成团队候选。" },
  { id: "read-only", label: "只读记忆", detail: "允许召回，不捕获或写入新记忆。" },
  { id: "off", label: "完全关闭", detail: "本 Session 不召回、不捕获、不生成候选。" }
];

export function ContextMemorySettings() {
  const workspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const [overview, setOverview] = useState<ContextMemoryOverview>();
  const [draft, setDraft] = useState<ContextMemoryConfiguration>();
  const [authorization, setAuthorization] = useState<EnterpriseDeviceAuthorization>();
  const [projects, setProjects] = useState<EnterpriseProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [busy, setBusy] = useState<"load" | "save" | "doctor" | "commit" | "auth" | "bind">();
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
      setError(cause instanceof Error ? cause.message : "无法读取 Context & Memory 状态。");
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
          publishNotification({ level: "success", title: "企业账户已连接", message: "本地私人记忆保持独立；现在可以绑定当前 Workspace。" });
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
      publishNotification({ level: "success", title: "Context & Memory 配置已保存", message: "新配置从下一轮或新 Session 起生效。" });
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
      publishNotification({ level: "success", title: "Workspace 已绑定", message: "完整学习模式下的脱敏候选可以提交企业审核。" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workspace 绑定失败。");
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

  const commit = async (): Promise<void> => {
    if (!workspaceId || !sessionId) return;
    setBusy("commit");
    try {
      await commitContextSession(workspaceId, sessionId);
      publishNotification({ level: "success", title: "Session Commit 已受理", message: "归档与记忆抽取在 Agent Host 中继续执行。" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Commit 未能受理。");
    } finally {
      setBusy(undefined);
    }
  };

  if (!draft || !overview) {
    return <SettingsNotice tone={error ? "danger" : "info"}>{error ?? "正在读取 OpenViking 有效配置…"}</SettingsNotice>;
  }

  const changed = configurationChanged(draft, overview.configuration);
  const privacy = PRIVACY_MODES.find((mode) => mode.id === draft.defaultPrivacyMode)!;
  return <div className={styles.workspace} data-testid="context-memory-settings">
    <SettingsSectionBlock
      title="Context & Memory"
      description="OpenViking 负责 Session Context、私人记忆和经验；Pi JSONL 始终是 Session 事实源。"
      actions={<div className={styles.actions}>
        <Button className="secondary-button" isDisabled={busy !== undefined} onPress={() => void doctor()}>测试连接</Button>
        <Button className="primary-button" isDisabled={!changed || busy !== undefined} onPress={() => void save()}>保存设置</Button>
      </div>}
    >
      <SettingsRows>
        <SettingsRow
          leading={<Database aria-hidden="true" size={17} />}
          title="OpenViking Runtime"
          description={overview.status.detail ?? "Memory 故障不会阻止 Pi；新 Session 启动前会校验唯一 Context Owner。"}
          value={healthLabel(overview.status.health)}
        />
        <SettingsRow title="Session Context Owner" description="Owner 在 Session 创建时锁定；修改配置后只对新 Session 生效。" value={ownerLabel(overview.status.owner)} />
        <SettingsRow title="Endpoint" description="远程地址必须使用 HTTPS；HTTP 仅允许 127.0.0.1 / localhost。">
          <Input
            aria-label="OpenViking Endpoint"
            className={styles.input!}
            value={draft.endpoint}
            onChange={(event) => setDraft({ ...draft, endpoint: event.currentTarget.value })}
          />
        </SettingsRow>
      </SettingsRows>
      {overview.status.conflictExtensions.length > 0 ? <SettingsNotice tone="danger">
        新 Session 检测到冲突的 Memory Owner：{overview.status.conflictExtensions.join("、")}。启动前门禁已阻止这些第三方 Memory Extension 加载；Pi 聊天、工具、JSONL 与默认 Compaction 继续可用，旧记忆数据不会被删除。
      </SettingsNotice> : null}
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
    </SettingsSectionBlock>

    <SettingsSectionBlock title="隐私与学习" description="默认是私人学习。完整学习只生成企业候选，不会自动发布。">
      <div aria-label="默认记忆模式" className={styles.privacyGrid} role="radiogroup">
        {PRIVACY_MODES.map((mode) => <Button
          aria-pressed={draft.defaultPrivacyMode === mode.id}
          className={styles.privacyCard!}
          data-selected={draft.defaultPrivacyMode === mode.id ? true : undefined}
          key={mode.id}
          onPress={() => setDraft({ ...draft, defaultPrivacyMode: mode.id })}
        >
          <strong>{mode.label}</strong><span>{mode.detail}</span>
        </Button>)}
      </div>
      <SettingsNotice tone="info"><ShieldCheck aria-hidden="true" size={14} /> 当前选择：{privacy.label}。Memory 始终以不可信上下文注入，不能授权 Shell、文件或外部操作。</SettingsNotice>
    </SettingsSectionBlock>

    <SettingsSectionBlock title="Session Context" description="Pi Extension 注入一次稳定启动 Recall；后续缺少历史时由 Pi 自动调用 OpenViking Tool，Desktop 只做治理和显式操作。">
      <SettingsRows>
        <SettingsRow leading={<BrainCircuit aria-hidden="true" size={17} />} title="Context Takeover" description={`达到 ${draft.takeover.tokenThreshold.toLocaleString()} tokens 后归档，保留最近 ${draft.takeover.keepRecentTurns} turns。`} value={draft.takeover.enabled ? "开启" : "关闭"} />
        <SettingsRow title="Commit 阈值" description="达到阈值后由 Extension 排队归档；失败时保留本地上下文。" value={`${draft.commitTokenThreshold.toLocaleString()} tokens`} />
        <SettingsRow title="单次召回预算" description={`启动快照和后续按需检索每次最多 ${draft.recallTokenBudget.toLocaleString()} tokens；私人 Experience ${draft.privateExperienceLimit} 条、本地 Resource ${draft.localResourceRecallLimit} 条、企业 Experience ${draft.sharedExperienceLimit} 条。`} value={`${draft.recallTokenBudget.toLocaleString()} tokens`} />
        <SettingsRow
          title="当前 Session"
          description={sessionId ? `Session ${sessionId.slice(0, 12)}…` : "当前没有可提交的 Pi Session。"}
          value={sessionId ? "可提交" : "未就绪"}
          actions={<Button className="secondary-button" isDisabled={!workspaceId || !sessionId || busy !== undefined} onPress={() => void commit()}>立即 Commit</Button>}
        />
      </SettingsRows>
    </SettingsSectionBlock>

    <SettingsSectionBlock title="企业记忆与经验" description="登录只增加共享召回和候选提交流程，不会把本地私人 Memory 改成公开数据。">
      <SettingsRows>
        <SettingsRow title="Enterprise Context Gateway" description="远程地址必须使用 HTTPS；本地联调只允许 loopback HTTP。">
          <Input
            aria-label="Enterprise Context Gateway Endpoint"
            className={styles.input!}
            placeholder="https://datahub.example.com"
            value={draft.enterpriseGatewayEndpoint}
            onChange={(event) => setDraft({ ...draft, enterpriseGatewayEndpoint: event.currentTarget.value })}
          />
        </SettingsRow>
        <SettingsRow
          leading={<Building2 aria-hidden="true" size={17} />}
          title="企业账户"
          description={overview.identity.state === "signed-in"
            ? `${overview.identity.displayName ?? overview.identity.userId ?? "企业用户"} · ${overview.identity.accountId ?? "企业空间"}`
            : "Desktop 只持有短期身份；Root/Admin Key 不进入客户端。"}
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
          description="只有已登录、可信且明确绑定的 Workspace 才能提交经验候选。"
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
        请在 DataHub 登录并确认此设备。验证码：<code>{authorization.userCode}</code>；完成后 Desktop 会自动刷新。
      </SettingsNotice> : null}
      {overview.identity.state === "signed-out" ? <SettingsNotice tone="info">企业 Context Gateway 尚未连接；本地私人记忆和私人经验不受影响。</SettingsNotice> : null}
      {changed && draft.enterpriseGatewayEndpoint ? <SettingsNotice tone="warning">请先保存 Gateway 地址，再连接企业账户。</SettingsNotice> : null}
    </SettingsSectionBlock>
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
