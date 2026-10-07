import type { PiProviderConfigurationView } from "@pi67/protocol";
import { KeyRound } from "lucide-react";
import { Button } from "react-aria-components";
import { SettingsRow, SettingsRows, SettingsSectionBlock, SettingsStatus } from "./SettingsPrimitives.js";
import styles from "./ProviderConfigurationPanel.module.css";

export function BuiltInProviderConnection({
  provider,
  onConfigureCredential
}: {
  provider: PiProviderConfigurationView;
  onConfigureCredential: () => void;
}) {
  const endpoints = distinctNonEmpty([
    provider.baseUrl,
    ...provider.models.map((model) => model.baseUrl)
  ]);
  const protocols = distinctNonEmpty([
    provider.api,
    ...provider.models.map((model) => model.api)
  ]);
  const credentialSource = builtInCredentialSource(provider);
  const searchConnection = builtInSearchConnection(provider.id);

  return (
    <section className={styles.connection} data-testid="builtin-provider-connection">
      <SettingsRows>
        <SettingsRow
          actions={<Button
            autoFocus={!provider.configured}
            className={provider.configured ? "secondary-button" : "primary-button"}
            onPress={onConfigureCredential}
          >
            <KeyRound aria-hidden="true" size={14} />
            {provider.configured ? "更新 API Key" : "配置 API Key"}
          </Button>}
          description={provider.configured
            ? `${credentialSource}；可以更新保存方式或移除 auth.json 中的凭据。`
            : `配置后即可使用这个服务提供的 ${provider.modelCount} 个模型。`}
          title="API Key"
          value={<SettingsStatus tone={provider.configured ? "success" : "warning"}>
            {provider.configured ? "认证已可用" : "需要 API Key"}
          </SettingsStatus>}
        />
      </SettingsRows>
      <SettingsSectionBlock
        info="内置服务不开放 URL、协议、Headers 或高级 JSON 编辑，避免把 Pi 内置目录复制成一份容易漂移的私有配置。如需代理地址或兼容服务，请返回列表，在“自定义”中新建独立模型服务。"
        title="服务信息"
      >
        <SettingsRows>
          <SettingsRow title="Provider ID" value={<code className={styles.connectionCode}>{provider.id}</code>} />
          <SettingsRow
            title="服务地址"
            value={endpoints.length > 0
              ? <span className={styles.connectionCodes}>{endpoints.map((endpoint) => <code className={styles.connectionCode} key={endpoint}>{endpoint}</code>)}</span>
              : "由 Pi 内置 Provider 管理"}
          />
          <SettingsRow
            title="API 协议"
            value={protocols.length > 0
              ? <span className={styles.connectionCodes}>{protocols.map((protocol) => <code className={styles.connectionCode} key={protocol}>{protocol}</code>)}</span>
              : "由 Pi 内置 Provider 管理"}
          />
          <SettingsRow description="推荐写入 Pi auth.json，重启后仍可用；仅本次使用则在完全退出后失效" title="凭据保存" />
          {searchConnection ? <SettingsRow description={searchConnection} title="原生搜索" /> : null}
        </SettingsRows>
      </SettingsSectionBlock>
    </section>
  );
}

function distinctNonEmpty(values: ReadonlyArray<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function builtInCredentialSource(provider: PiProviderConfigurationView): string {
  if (provider.credentialSource === "runtime") return "当前使用运行内存中的 API Key，完全退出后失效";
  if (provider.credentialSource === "stored") return "凭据已保存到 Pi auth.json";
  if (provider.credentialSource === "environment") return "凭据来自环境配置";
  if (provider.credentialSource === "models_json_key") return "凭据来自 Pi models.json";
  if (provider.credentialSource === "models_json_command") return "凭据由 Pi models.json 命令提供";
  if (provider.credentialSource === "fallback") return "凭据来自 Provider 默认认证";
  return "Pi 已解析当前认证";
}

function builtInSearchConnection(providerId: string): string | undefined {
  if (providerId !== "deepseek") return undefined;
  return "DeepSeek 官方目录模型通过 Responses /responses 自动联网搜索，并与对话共用这个 API Key；目录刷新后新增模型沿用同一官方 Provider 路由";
}
