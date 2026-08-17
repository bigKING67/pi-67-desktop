import type {
  LarkAuthLoginStartResult,
  LarkAuthSnapshot,
  LarkTokenStatus
} from "@pi67/domain";
import { LARK_CLI_SKILL_PACK_ID } from "@pi67/domain";
import { Bot, ExternalLink, RefreshCw, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import { LarkApplicationSettings } from "./LarkApplicationSettings.js";
import { LarkCliRequiredNotice } from "./LarkCliRequiredNotice.js";
import { SkillPackMutationDialog } from "./ManagedGlobalSkillPanel.js";
import { beginLarkUserLogin, loadLarkAuthStatus } from "./lark-auth-controller.js";
import { installSkillPack, loadSkillPacks } from "./skill-pack-controller.js";
import { useSkillPackStore } from "./skill-pack-store.js";
import styles from "./LarkOfficeSettings.module.css";

const AUTH_POLL_INTERVAL_MS = 1_500;
type LarkSettingsTab = "user" | "application";

export function LarkOfficeSettings() {
  const mounted = useRef(true);
  const connectionSetupPending = useRef(false);
  const continuingLogin = useRef(false);
  const [snapshot, setSnapshot] = useState<LarkAuthSnapshot>();
  const [login, setLogin] = useState<LarkAuthLoginStartResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedTab, setSelectedTab] = useState<LarkSettingsTab>("user");
  const [installConfirmationOpen, setInstallConfirmationOpen] = useState(false);
  const skillPackLoadRequested = useRef(false);
  const larkPack = useSkillPackStore((state) => (
    state.items.find((entry) => entry.id === LARK_CLI_SKILL_PACK_ID)
  ));
  const skillPackPhase = useSkillPackStore((state) => state.phase);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async (showProgress = true): Promise<void> => {
    if (showProgress) setBusy(true);
    try {
      const next = await loadLarkAuthStatus();
      if (!mounted.current) return;
      setSnapshot(next);
      setError(undefined);
      if (connectionSetupPending.current && next.phase === "error") {
        connectionSetupPending.current = false;
      }
      if (next.phase !== "authorizing"
        && !(connectionSetupPending.current && next.appStatus === "ready")) {
        setLogin(undefined);
      }
    } catch (cause) {
      if (!mounted.current) return;
      setError(errorMessage(cause, "无法读取飞书连接状态。"));
    } finally {
      if (mounted.current && showProgress) setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (snapshot?.cliStatus !== "missing" || skillPackLoadRequested.current) return;
    skillPackLoadRequested.current = true;
    void loadSkillPacks();
  }, [snapshot?.cliStatus]);

  useEffect(() => {
    if (snapshot?.phase !== "authorizing") return;
    let cancelled = false;
    let timer: ReturnType<typeof globalThis.setTimeout>;
    const poll = () => {
      timer = globalThis.setTimeout(() => {
        void refresh(false).finally(() => {
          if (!cancelled) poll();
        });
      }, AUTH_POLL_INTERVAL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timer);
    };
  }, [refresh, snapshot?.phase]);

  const openAuthorizationPage = useCallback(async (url: string): Promise<void> => {
    let opened = false;
    try {
      opened = await window.pi67.system.requestOpenExternal(url);
    } catch {
      // The authorization remains active so the same verified URL can be retried.
    }
    if (mounted.current) setError(opened
      ? undefined
      : "未能打开飞书授权页，请检查系统默认浏览器后重试。");
  }, []);

  const beginLogin = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const started = await beginLarkUserLogin();
      if (!mounted.current) return;
      connectionSetupPending.current = started.stage === "connection-setup";
      setLogin(started);
      setSnapshot(started.status);
      await openAuthorizationPage(started.verificationUrl);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, "无法发起飞书用户授权。"));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [openAuthorizationPage]);

  const authorizing = snapshot?.phase === "authorizing";
  const cliMissing = snapshot?.cliStatus === "missing";
  const userConnected = snapshot?.verified === true;
  const needsRefresh = snapshot?.tokenStatus === "needs-refresh";
  const installingCli = skillPackPhase === "installing";

  useEffect(() => {
    if (!connectionSetupPending.current
      || continuingLogin.current
      || snapshot?.appStatus !== "ready"
      || snapshot.phase !== "disconnected") return;
    continuingLogin.current = true;
    connectionSetupPending.current = false;
    void beginLogin().finally(() => { continuingLogin.current = false; });
  }, [beginLogin, snapshot?.appStatus, snapshot?.phase]);

  const installLarkCli = async (): Promise<void> => {
    const installed = await installSkillPack(LARK_CLI_SKILL_PACK_ID);
    if (!installed || !mounted.current) return;
    setInstallConfirmationOpen(false);
    await refresh();
  };

  return <><Tabs
    className={styles.workspace!}
    data-testid="lark-office-settings"
    selectedKey={selectedTab}
    onSelectionChange={(key) => setSelectedTab(key === "application" ? "application" : "user")}
  >
    <TabList aria-label="飞书身份设置" className={styles.tabList!}>
      <Tab className={styles.tab!} id="user">
        <UserRound aria-hidden="true" size={15} />用户授权
      </Tab>
      <Tab className={styles.tab!} id="application">
        <Bot aria-hidden="true" size={15} />应用连接
      </Tab>
    </TabList>

    <TabPanel className={styles.tabPanel!} id="user">
      <SettingsSectionBlock
        title="用户授权"
        description="使用你的飞书身份访问个人云空间、日历、消息、任务和邮箱；这是办公能力的主要授权入口。"
      >
        {cliMissing ? <LarkCliRequiredNotice
          canInstall={larkPack?.canInstall === true}
          installing={installingCli}
          onInstall={() => setInstallConfirmationOpen(true)}
        /> : null}
        <SettingsRows>
          <SettingsRow
            leading={<UserRound aria-hidden="true" size={17} />}
            title={snapshot?.userName ?? "飞书用户"}
            description={userDescription(snapshot)}
            value={userStatusLabel(snapshot, busy, login?.stage)}
            actions={<Button
              className={userConnected ? "secondary-button" : "primary-button"}
              isDisabled={busy || authorizing || cliMissing || snapshot === undefined}
              onPress={() => void beginLogin()}
            >
              <ExternalLink aria-hidden="true" size={14} />
              {authorizing
                ? login?.stage === "connection-setup" ? "准备连接" : "等待授权"
                : userConnected ? "重新授权" : "登录飞书"}
            </Button>}
          />
          <SettingsRow
            title="本机授权"
            description="OAuth Token 仅由本机 lark-cli 保存；π、Renderer 与 Pi Session 不读取或持久化它。"
            value={tokenStatusLabel(snapshot?.tokenStatus)}
          />
          <SettingsRow
            title="状态检查"
            description={snapshot ? `最近检查：${formatTime(snapshot.checkedAt)}` : "正在连接 Agent Host。"}
            value={snapshot?.tokenExpiresAt === undefined
              ? undefined
              : `到期：${formatTime(snapshot.tokenExpiresAt)}`}
            actions={<Button
              className="secondary-button"
              isDisabled={busy || authorizing}
              onPress={() => void refresh()}
            >
              <RefreshCw aria-hidden="true" size={14} />
              {busy ? "正在刷新" : "刷新状态"}
            </Button>}
          />
        </SettingsRows>
        {authorizing ? <SettingsNotice actions={login ? <Button
          className="secondary-button"
          onPress={() => void openAuthorizationPage(login.verificationUrl)}
        >
          <ExternalLink aria-hidden="true" size={14} />
          {login.stage === "connection-setup" ? "打开准备页" : "打开授权页"}
        </Button> : undefined}>
          <span>
            {login?.stage === "connection-setup"
              ? "请在浏览器确认一键准备飞书连接；完成后会自动继续个人账号授权。"
              : "请在浏览器完成飞书确认，页面会自动刷新。"}
            {login?.userCode ? <> 验证码：<code>{login.userCode}</code>。</> : null}
          </span>
        </SettingsNotice> : null}
        {needsRefresh ? <SettingsNotice>
          当前访问令牌待续期；Lark CLI 会在下一次用户身份 API 调用时自动完成续期。
        </SettingsNotice> : null}
        {!cliMissing && snapshot !== undefined && snapshot.appStatus !== "ready" && !authorizing ? <SettingsNotice>
          首次登录只申请 Lark CLI 推荐权限，并一键准备基础连接，无需填写 App ID 或 App Secret。
          其他能力缺少权限时再按需增量授权；如果组织策略限制应用创建或权限审批，需由管理员批准，
          或在“应用连接”中复用已有应用。
        </SettingsNotice> : null}
        {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
      </SettingsSectionBlock>
    </TabPanel>

    <TabPanel className={styles.tabPanel!} id="application">
      <LarkApplicationSettings
        canInstallLarkCli={larkPack?.canInstall === true}
        installingLarkCli={installingCli}
        snapshot={snapshot}
        onInstallLarkCli={() => setInstallConfirmationOpen(true)}
        onSnapshotChange={setSnapshot}
      />
    </TabPanel>
  </Tabs>
  {installConfirmationOpen && larkPack ? <SkillPackMutationDialog
    action="install"
    busy={installingCli}
    error={skillPackPhase === "failed" ? useSkillPackStore.getState().error : undefined}
    pack={larkPack}
    onCancel={() => setInstallConfirmationOpen(false)}
    onConfirm={installLarkCli}
  /> : null}</>;
}

function userStatusLabel(
  snapshot: LarkAuthSnapshot | undefined,
  busy: boolean,
  stage: LarkAuthLoginStartResult["stage"] | undefined
): string {
  if (!snapshot) return busy ? "正在读取" : "未知";
  if (snapshot.phase === "authorizing") return stage === "connection-setup" ? "准备登录" : "授权中";
  if (snapshot.phase === "error") return "检查失败";
  if (snapshot.cliStatus === "missing") return "CLI 未安装";
  if (snapshot.verified && snapshot.tokenStatus === "needs-refresh") return "待自动续期";
  return snapshot.verified ? "已连接" : "未登录";
}

function userDescription(snapshot: LarkAuthSnapshot | undefined): string {
  if (!snapshot) return "正在读取用户授权状态。";
  return snapshot.detail ?? (snapshot.verified
    ? "Lark CLI 与官方办公技能可复用此用户身份。"
    : "登录后，官方办公技能可按你的用户权限访问飞书资源。");
}

function tokenStatusLabel(status: LarkTokenStatus | undefined): string {
  if (status === "valid") return "有效";
  if (status === "needs-refresh") return "即将到期";
  if (status === "expired") return "已过期";
  if (status === "invalid") return "无效";
  return status === "unknown" ? "状态未知" : "未授权";
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}
