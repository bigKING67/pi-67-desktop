import type { ContextMemoryConfiguration } from "@pi67/domain";
import type { EnterpriseDeviceAuthorization } from "@pi67/protocol";
import { useEffect, useState } from "react";
import { Button, Input } from "react-aria-components";
import { beginEnterpriseAuthorization, disconnectEnterpriseAccount, loadEnterpriseIdentity,
  loadContextMemoryOverview, pollEnterpriseAuthorization, saveContextMemoryConfiguration } from "../context-memory/context-memory-controller.js";
import { useNewMoneyAccount } from "../context-memory/use-new-money-account.js";
import { newMoneyAccountLabel } from "../context-memory/new-money-account-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { SettingsNotice, SettingsRow, SettingsRows, SettingsSectionBlock } from "./SettingsPrimitives.js";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";
import styles from "./ContextMemorySettings.module.css";

export function NewMoneyAccountSettings() {
  const account = useNewMoneyAccount();
  const [configuration, setConfiguration] = useState<ContextMemoryConfiguration>();
  const [endpoint, setEndpoint] = useState("");
  const [authorization, setAuthorization] = useState<EnterpriseDeviceAuthorization>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true;
    void loadContextMemoryOverview(undefined, false).then(result => {
      if (current) { setConfiguration(result.configuration); setEndpoint(result.configuration.enterpriseGatewayEndpoint); }
    }).catch(() => { if (current) setError("无法读取账户服务配置，请重新打开此页。 "); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!authorization) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const identity = await pollEnterpriseAuthorization(authorization.authorizationId);
        if (cancelled) return;
        if (identity.state === "signed-in" || identity.state === "expired" || identity.state === "signed-out") {
          setAuthorization(undefined);
          if (identity.state === "expired") setError("授权码已过期，请重新登录。");
          return;
        }
      } catch { if (!cancelled) setError("暂时无法检查授权结果，请检查连接；你也可以取消登录。"); }
      if (!cancelled) timer = setTimeout(() => void poll(), authorization.intervalSeconds * 1000);
    };
    timer = setTimeout(() => void poll(), authorization.intervalSeconds * 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [authorization]);
  const changed = !!configuration && endpoint !== configuration.enterpriseGatewayEndpoint;
  useSettingsDraftRegistration({ dirty: changed, busy: busy || !!authorization, subject: "New Money 账户", discard: () => setEndpoint(configuration?.enterpriseGatewayEndpoint ?? "") });
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(undefined);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "账户操作失败，请重试。"); }
    finally { setBusy(false); }
  };
  const signedIn = account.identity?.state === "signed-in";
  return <div data-testid="new-money-account-settings">
    <SettingsSectionBlock title="New Money 账户" description="Desktop 与网页管理使用同一账户。登录不改变私人会话范围，也不会自动上传私人记忆。">
      {error || account.error ? <SettingsNotice tone="danger">{error ?? account.error}</SettingsNotice> : null}
      <SettingsRows>
        <SettingsRow title={newMoneyAccountLabel(account).title} description={newMoneyAccountLabel(account).detail}
          actions={<>
            <Button className="secondary-button" isDisabled={busy || !!authorization} onPress={() => void perform(async () => { await loadEnterpriseIdentity(true); })}>刷新状态</Button>
            {signedIn || authorization || account.identity?.state === "pending" ? <Button className="secondary-button" isDisabled={busy}
              onPress={() => void perform(async () => { setAuthorization(undefined); await disconnectEnterpriseAccount(); })}>{signedIn ? "退出登录" : "取消登录"}</Button>
              : <Button className="primary-button" isDisabled={busy || changed || !configuration || !endpoint || account.loading}
                onPress={() => void perform(async () => { setAuthorization(await beginEnterpriseAuthorization()); })}>登录 New Money</Button>}
          </>} />
        <SettingsRow title="服务地址" description="远程服务使用 HTTPS；只有本机联调允许回环 HTTP。更换服务前请先退出登录。">
          <Input aria-label="New Money 服务地址" className={styles.input!} value={endpoint} disabled={busy || !!authorization || signedIn || !configuration}
            onChange={event => setEndpoint(event.currentTarget.value)} />
          {changed ? <Button className="secondary-button" isDisabled={busy || !!authorization}
            onPress={() => void perform(async () => {
              if (!configuration) return;
              const saved = await saveContextMemoryConfiguration({ expectedRevision: configuration.revision,
                enabled: configuration.enabled, endpoint: configuration.endpoint, enterpriseGatewayEndpoint: endpoint,
                defaultPrivacyMode: configuration.defaultPrivacyMode, recallTokenBudget: configuration.recallTokenBudget,
                scoreThreshold: configuration.scoreThreshold, commitTokenThreshold: configuration.commitTokenThreshold,
                captureAssistantTurns: configuration.captureAssistantTurns, privateExperienceLimit: configuration.privateExperienceLimit,
                localResourceRecallLimit: configuration.localResourceRecallLimit, sharedExperienceLimit: configuration.sharedExperienceLimit,
                takeover: configuration.takeover });
              setConfiguration(saved); setEndpoint(saved.enterpriseGatewayEndpoint); await loadEnterpriseIdentity();
            })}>保存服务地址</Button> : null}
        </SettingsRow>
        <SettingsRow title="团队与项目" description="团队成员管理使用网页后台；当前工作区的团队项目绑定位于团队经验设置。"
          actions={<>
            <Button className="secondary-button" isDisabled={!signedIn || busy || !!authorization || changed || !configuration}
              onPress={() => void perform(async () => { if (configuration) await window.pi67.system.requestOpenExternal(configuration.enterpriseGatewayEndpoint); })}>打开管理网页</Button>
            <Button className="secondary-button" isDisabled={busy || !!authorization || changed}
              onPress={() => rendererWorkbenchStore.getState().openSettings("context-memory")}>团队经验设置</Button>
          </>} />
      </SettingsRows>
      {authorization ? <SettingsNotice actions={<Button className="secondary-button"
        onPress={() => void perform(async () => { await window.pi67.system.requestOpenExternal(authorization.verificationUri); })}>打开登录授权页</Button>}>
        请在网页登录并确认此设备。验证码：<code>{authorization.userCode}</code>。确认后自动更新账户状态。
      </SettingsNotice> : null}
    </SettingsSectionBlock>
    <SettingsSectionBlock title="本地数据与隐私" description="未登录仍可使用本地工作台。登录状态与私人／团队会话范围是两回事。">
      <SettingsRows><SettingsRow title="会话与私人记忆" description="保存在本机，不会因登录自动上传。退出账户不会删除本地数据；模型处理会按配置发送给对应服务。" />
        <SettingsRow title="团队共享知识" description="只有明确选择团队项目的会话才能使用获授权的共享知识，每次处理仍需校验当前权限。" /></SettingsRows>
    </SettingsSectionBlock>
  </div>;
}
