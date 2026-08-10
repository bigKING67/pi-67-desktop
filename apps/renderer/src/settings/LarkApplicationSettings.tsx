import {
  MAX_LARK_APP_ID_CHARS,
  MAX_LARK_APP_SECRET_CHARS,
  type LarkAppBrand,
  type LarkAuthSnapshot
} from "@pi67/domain";
import { Bot, Eye, EyeOff, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input } from "react-aria-components";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import { saveLarkApplicationConfiguration } from "./lark-auth-controller.js";
import styles from "./LarkApplicationSettings.module.css";

export function LarkApplicationSettings({ snapshot, onSnapshotChange }: {
  snapshot: LarkAuthSnapshot | undefined;
  onSnapshotChange: (snapshot: LarkAuthSnapshot) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [brand, setBrand] = useState<LarkAppBrand>("feishu");
  const [secretVisible, setSecretVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (appSecret.length === 0) setSecretVisible(false);
  }, [appSecret]);

  const beginEditing = () => {
    setAppId(snapshot?.appId ?? "");
    setAppSecret("");
    setBrand(snapshot?.appBrand ?? "feishu");
    setSecretVisible(false);
    setError(undefined);
    setEditing(true);
  };
  const cancelEditing = () => {
    setEditing(false);
    setAppSecret("");
    setSecretVisible(false);
    setError(undefined);
  };
  const validation = validateApplicationDraft(appId, appSecret);
  const save = async (): Promise<void> => {
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const next = await saveLarkApplicationConfiguration({
        appId: appId.trim(),
        appSecret,
        brand
      });
      onSnapshotChange(next);
      setEditing(false);
      setAppSecret("");
      setSecretVisible(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const configured = snapshot?.appStatus === "ready";
  const cliMissing = snapshot?.cliStatus === "missing";
  return <SettingsSectionBlock
    title="飞书应用"
    description="配置当前设备使用的飞书开放平台应用；Bot 身份和用户授权都会基于该应用工作。"
  >
    <SettingsRows>
      <SettingsRow
        leading={<Bot aria-hidden="true" size={17} />}
        title={snapshot?.appName ?? "飞书应用"}
        description={applicationDescription(snapshot)}
        value={applicationStatusLabel(snapshot)}
        actions={<Button
          className={configured ? "secondary-button" : "primary-button"}
          isDisabled={saving || cliMissing || snapshot === undefined}
          onPress={beginEditing}
        >
          <Pencil aria-hidden="true" size={14} />
          {snapshot?.appId ? "编辑配置" : "配置应用"}
        </Button>}
      />
      {snapshot?.appId ? <SettingsRow
        title="App ID"
        description="当前生效的飞书开放平台应用标识。"
        value={<code className={styles.appId}>{snapshot.appId}</code>}
      /> : null}
      <SettingsRow
        title="App Secret"
        description="编辑时可以显隐核对；保存后由 lark-cli 保管，Pi-67 不回读明文。"
        value={configured ? "已安全保存" : "未验证"}
      />
      <SettingsRow
        title="配置来源"
        description="当前版本管理本机 lark-cli 的生效配置；组织托管配置后续保持只读。"
        value={snapshot?.appBrand === "lark" ? "本机 Lark CLI" : "本机飞书 CLI"}
      />
    </SettingsRows>

    {editing ? <form
      aria-label="飞书应用配置"
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className={styles.editorHeader}>
        <strong>{snapshot?.appId ? "编辑飞书应用" : "配置飞书应用"}</strong>
        <small>验证成功后，App ID 会继续显示；App Secret 只在本次编辑中可见。</small>
      </header>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>App ID</span>
          <Input
            autoComplete="off"
            autoFocus
            disabled={saving}
            maxLength={MAX_LARK_APP_ID_CHARS}
            placeholder="cli_xxxxxxxxxxxxxxxx"
            spellCheck={false}
            value={appId}
            onChange={(event) => setAppId(event.target.value)}
          />
          <small>通常以 <code>cli_</code> 开头，可在飞书开放平台的应用凭证页找到。</small>
        </label>
        <label className={styles.field}>
          <span>区域</span>
          <select
            disabled={saving}
            value={brand}
            onChange={(event) => setBrand(event.target.value as LarkAppBrand)}
          >
            <option value="feishu">飞书</option>
            <option value="lark">Lark</option>
          </select>
          <small>中国大陆使用飞书；国际版使用 Lark。</small>
        </label>
      </div>
      <label className={styles.field}>
        <span>App Secret</span>
        <span className={styles.secretControl}>
          <Input
            aria-label="App Secret"
            autoComplete="new-password"
            disabled={saving}
            maxLength={MAX_LARK_APP_SECRET_CHARS}
            placeholder={snapshot?.appId ? "重新输入 App Secret 以验证配置" : "输入 App Secret"}
            spellCheck={false}
            type={secretVisible ? "text" : "password"}
            value={appSecret}
            onChange={(event) => setAppSecret(event.target.value)}
          />
          <Button
            aria-label={secretVisible ? "隐藏 App Secret" : "显示 App Secret"}
            aria-pressed={secretVisible}
            className={styles.secretToggle!}
            isDisabled={saving || appSecret.length === 0}
            onPress={() => setSecretVisible((visible) => !visible)}
            type="button"
          >
            {secretVisible
              ? <EyeOff aria-hidden="true" size={16} />
              : <Eye aria-hidden="true" size={16} />}
          </Button>
        </span>
        <small>密钥通过 stdin 一次性交给 lark-cli，不进入命令行参数、Pi Session 或普通日志。</small>
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <footer className={styles.actions}>
        <Button className="secondary-button" isDisabled={saving} onPress={cancelEditing} type="button">
          取消
        </Button>
        <Button
          className="primary-button"
          isDisabled={saving || validation !== undefined}
          type="submit"
        >
          {saving ? "正在验证" : "验证并保存"}
        </Button>
      </footer>
    </form> : null}

    {cliMissing ? <SettingsNotice tone="warning">
      未找到 lark-cli。请先在“技能”中安装或修复飞书 Lark CLI，再配置应用。
    </SettingsNotice> : <SettingsNotice>
      App ID 可以在此查看；App Secret 保存后只显示安全状态，如需更换请重新输入。
    </SettingsNotice>}
  </SettingsSectionBlock>;
}

function validateApplicationDraft(appId: string, appSecret: string): string | undefined {
  if (!/^cli_[A-Za-z0-9]+$/u.test(appId.trim())) return "请输入有效的 App ID，通常以 cli_ 开头。";
  if (appId !== appId.trim()) return "App ID 前后不能包含空格。";
  if (!appSecret) return "请输入 App Secret。";
  if (/\s/u.test(appSecret)) return "App Secret 不能包含空格或换行。";
  return undefined;
}

function applicationStatusLabel(snapshot: LarkAuthSnapshot | undefined): string {
  if (!snapshot || snapshot.appStatus === "unknown") return "未知";
  return snapshot.appStatus === "ready" ? "已连接" : "未配置";
}

function applicationDescription(snapshot: LarkAuthSnapshot | undefined): string {
  if (!snapshot) return "正在读取应用配置。";
  if (snapshot.appStatus === "ready") return "应用身份已验证，可用于 Bot 身份及后续用户授权。";
  if (snapshot.cliStatus === "missing") return "安装或修复 lark-cli 后即可配置应用。";
  return snapshot.appId
    ? "已检测到 App ID，但应用身份尚未通过验证。"
    : "配置自己的 App ID 与 App Secret 后即可使用飞书能力。";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : "无法验证并保存飞书应用，请检查 App ID 与 App Secret 后重试。";
}
